/**
 * 牧場的狀態：哪個 Claude／Codex session 認養了哪隻寶可夢（存檔，重開 App 還在）＋每個主 agent 現在在做什麼。
 *
 * 認養：第一次看到某個 session_id 的事件，就從還沒人養的品種裡隨機挑一隻（全部都有人養了才重複）。
 * 對應關係存在 ranch.json（APP_DATA_DIR），🔴 寵物不會自己消失：session 結束只是變成「不在線」、
 * 時間到了去睡覺；要拿掉只能從選單（macOS 的 Dock、Windows 的系統匣）「放生」（一隻）或「全部放生」。
 *
 * 只看主 agent（事件沒有 agent_id）。子代理不另外養寵物，它的事件只算「這個 session 還有動靜」
 * （不然子代理跑很久時，主 agent 沒事件，寵物會睡著）；子代理要權限時算主 agent 在等你（按的是同一個對話框）。
 *
 * | 事件 | 主 agent 變成 |
 * |------|------|
 * | SessionStart | idle（上線） |
 * | UserPromptSubmit、PostToolUse | busy「思考中…」 |
 * | PreToolUse | busy「動詞：說明」；AskUserQuestion、ExitPlanMode 是 waiting |
 * | PostToolUseFailure | error「○○失敗了」＋錯誤提醒；Esc 中斷（is_interrupt）當成 busy |
 * | PermissionRequest | waiting「需要你確認」＋提示音 |
 * | PreCompact | compacting「整理記憶中…」 |
 * | Stop | idle＋完成提醒（原本不是 idle 才算） |
 * | SessionEnd | 不在線（寵物留著） |
 */
import { copyFile, readFile, rename, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { AgentMode, AgentProvider, PetView, RanchUpdate } from '../shared/ranch-protocol'
import type { HookEvent } from './hook-server'
import type { SessionMeta } from './session-meta'
import { APP_DATA_DIR } from './species'

const ROSTER_FILE = path.join(APP_DATA_DIR, 'ranch.json')

/**
 * 暫存檔換成正式檔。Windows 上 rename 可能失敗（2026-11-13 實測：同一個資料夾裡 rename 回 EXDEV；
 * 防毒正在掃剛寫好的暫存檔時也會 EPERM／EBUSY）：先重試幾次，還是不行就直接複製過去，存檔不能因此丟掉
 */
async function replaceFile(tmp: string, target: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await rename(tmp, target)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EXDEV') break
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
  await copyFile(tmp, target)
  await rm(tmp, { force: true })
}

const THINKING = '思考中…'
/** busy 多久沒有事件就當成結束（長指令在 PreToolUse 與 PostToolUse 之間沒有事件） */
const BUSY_STALE_MS = 3 * 60_000
/** waiting 撐比較久：使用者可能離開座位，回來時還要看得到 */
const WAITING_STALE_MS = 30 * 60_000
const SWEEP_INTERVAL_MS = 15_000
/** lastEventAt 每個事件都會變，存檔最多這麼久一次 */
const SAVE_THROTTLE_MS = 30_000
/** 標題可能隨時被改名：每個 session 最多這麼久重查一次；這些事件之後一定重查 */
const META_REFRESH_MS = 30_000
const META_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop'])

interface PetRecord {
  sessionId: string
  provider: AgentProvider
  speciesId: string
  adoptedAt: number
  lastEventAt: number
  title: string | null
  project: string | null
}

interface PetState extends PetRecord {
  active: boolean
  mode: AgentMode
  label: string | null
  transcriptPath: string | null
  metaCheckedAt: number
  metaLoading: boolean
}

function toolVerb(tool: string): string {
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'LS':
      return '翻檔案'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return '寫程式'
    case 'Bash':
      return '跑指令'
    case 'WebFetch':
    case 'WebSearch':
      return '查資料'
    case 'Task':
    case 'Agent':
      return '派小幫手'
    default:
      return tool.startsWith('mcp__') ? '用外掛工具' : `用 ${tool}`
  }
}

function toolLabel(tool: string | undefined, detail: string | undefined): string {
  if (tool === undefined) return THINKING
  return detail ? `${toolVerb(tool)}：${detail}` : `${toolVerb(tool)}中…`
}

function failureLabel(tool: string | undefined, detail: string | undefined): string {
  const verb = tool === undefined ? '出錯了' : `${toolVerb(tool)}失敗了`
  return detail ? `${verb}：${detail}` : verb
}

function permissionLabel(event: HookEvent): string {
  const who = event.agent_id ? '小幫手需要你確認' : '需要你確認'
  if (!event.tool_name) return who
  return `${who}：${toolVerb(event.tool_name)}${event.detail ? ` ${event.detail}` : ''}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseRecord(value: unknown): PetRecord | null {
  const r = asRecord(value)
  if (!r || typeof r.sessionId !== 'string' || typeof r.speciesId !== 'string') return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  return {
    sessionId: r.sessionId,
    provider: r.provider === 'codex' ? 'codex' : 'claude',
    speciesId: r.speciesId,
    adoptedAt: num(r.adoptedAt),
    lastEventAt: num(r.lastEventAt),
    title: str(r.title),
    project: str(r.project),
  }
}

export class RanchState {
  private readonly pets = new Map<string, PetState>()
  private speciesIds: string[] = []
  private readonly sweepTimer: NodeJS.Timeout
  private saveTimer: NodeJS.Timeout | undefined
  private saving: Promise<void> = Promise.resolve()
  private readonly emit: (update: RanchUpdate) => void
  private readonly resolveMeta: (sessionId: string, transcriptPath: string | null) => Promise<SessionMeta>

  constructor(
    emit: (update: RanchUpdate) => void,
    resolveMeta: (sessionId: string, transcriptPath: string | null) => Promise<SessionMeta>,
  ) {
    this.emit = emit
    this.resolveMeta = resolveMeta
    this.sweepTimer = setInterval(() => this.sweep(Date.now()), SWEEP_INTERVAL_MS)
  }

  /** 讀存檔（App 啟動時）；壞掉或不存在就從空牧場開始 */
  async load(): Promise<void> {
    try {
      const data = asRecord(JSON.parse(await readFile(ROSTER_FILE, 'utf8')))
      const list = Array.isArray(data?.pets) ? data.pets : []
      for (const item of list) {
        const record = parseRecord(item)
        if (!record) continue
        this.pets.set(record.sessionId, {
          ...record,
          active: false,
          mode: 'idle',
          label: null,
          transcriptPath: null,
          metaCheckedAt: 0,
          metaLoading: false,
        })
      }
    } catch {
      // 第一次開：還沒有存檔
    }
  }

  setSpecies(ids: string[]): void {
    this.speciesIds = ids
  }

  dispose(): Promise<void> {
    clearInterval(this.sweepTimer)
    clearTimeout(this.saveTimer)
    return this.save()
  }

  list(): PetView[] {
    return [...this.pets.values()].map((p) => ({
      sessionId: p.sessionId,
      provider: p.provider,
      speciesId: p.speciesId,
      title: p.title,
      project: p.project,
      active: p.active,
      mode: p.mode,
      label: p.label,
      lastEventAt: p.lastEventAt,
      adoptedAt: p.adoptedAt,
    }))
  }

  snapshot(cue: RanchUpdate['cue'] = null): RanchUpdate {
    return { pets: this.list(), cue }
  }

  /** 從選單放生一隻 */
  release(sessionId: string): void {
    if (!this.pets.delete(sessionId)) return
    void this.save()
    this.emit(this.snapshot())
  }

  /**
   * 從選單「全部放生」（2026-11-13 使用者「新增一個功能 全部放生」）：牧場清空、立刻存檔。
   * 還開著的 session 下一個事件進來時會照常重新認養一隻（跟放生一隻一樣）。回傳放生了幾隻
   */
  releaseAll(): number {
    const count = this.pets.size
    if (count === 0) return 0
    this.pets.clear()
    void this.save()
    this.emit(this.snapshot())
    return count
  }

  handle(event: HookEvent): void {
    // 保留 Claude 舊存檔的 key；Codex 加來源前綴，同名 session 也各養一隻。
    event = { ...event, session_id: event.provider === 'codex' ? `codex:${event.session_id}` : event.session_id }
    // 桌寵開著之前就在跑、剛好結束的 session：不為了一個 SessionEnd 認養
    if (event.hook_event_name === 'SessionEnd' && !this.pets.has(event.session_id)) return
    const now = Date.now()
    const pet = this.ensure(event, now)
    const prevMode = pet.mode
    // SessionEnd 是道別，不算「有動靜」：睡著的寵物不會因為 session 關掉而被吵醒
    if (event.hook_event_name !== 'SessionEnd') pet.lastEventAt = now
    let cue: RanchUpdate['cue'] = null
    const id = pet.sessionId

    if (event.hook_event_name === 'PermissionRequest') {
      this.set(pet, 'waiting', permissionLabel(event))
    } else if (event.agent_id) {
      // 子代理：只更新「有動靜」的時間（上面已經做了），不改主 agent 的狀態
    } else {
      switch (event.hook_event_name) {
        case 'SessionStart':
          this.set(pet, 'idle', null)
          break
        case 'UserPromptSubmit':
        case 'PostToolUse':
        case 'PostCompact':
          this.set(pet, 'busy', THINKING)
          break
        case 'PreToolUse':
          if (event.tool_name === 'AskUserQuestion') this.set(pet, 'waiting', event.detail ? `有問題想問你：${event.detail}` : '有問題想問你')
          else if (event.tool_name === 'ExitPlanMode') this.set(pet, 'waiting', '計畫等你確認')
          else this.set(pet, 'busy', toolLabel(event.tool_name, event.detail))
          break
        case 'PostToolUseFailure':
          if (event.is_interrupt) {
            this.set(pet, 'busy', THINKING)
          } else {
            this.set(pet, 'error', failureLabel(event.tool_name, event.detail))
            cue = { sessionId: id, kind: 'error' }
          }
          break
        case 'PreCompact':
          this.set(pet, 'compacting', '整理記憶中…')
          break
        case 'Stop':
          this.set(pet, 'idle', null)
          if (prevMode !== 'idle') cue = { sessionId: id, kind: 'done' }
          break
        case 'Interrupt':
          // 中斷不代表成功完成，不播放完成音效。
          this.set(pet, 'idle', null)
          break
        case 'SessionEnd':
          this.set(pet, 'idle', null)
          pet.active = false
          void this.save()
          break
        default:
          break
      }
    }
    if (pet.mode === 'waiting' && prevMode !== 'waiting') cue = { sessionId: id, kind: 'waiting' }

    this.scheduleSave()
    this.emit(this.snapshot(cue))
    if (pet.provider === 'claude' && !event.session_title && pet.active && (META_EVENTS.has(event.hook_event_name) || now - pet.metaCheckedAt > META_REFRESH_MS)) {
      void this.refreshMeta(pet)
    }
  }

  private ensure(event: HookEvent, now: number): PetState {
    let pet = this.pets.get(event.session_id)
    if (!pet) {
      pet = {
        sessionId: event.session_id,
        provider: event.provider ?? 'claude',
        speciesId: this.pickSpecies(),
        adoptedAt: now,
        lastEventAt: now,
        title: null,
        project: null,
        active: true,
        mode: 'idle',
        label: null,
        transcriptPath: null,
        metaCheckedAt: 0,
        metaLoading: false,
      }
      this.pets.set(pet.sessionId, pet)
      console.log(`[ranch] ${pet.sessionId.slice(0, 8)} 認養了 #${pet.speciesId}`)
      void this.save()
    }
    if (event.hook_event_name !== 'SessionEnd') pet.active = true
    if (event.cwd) pet.project = path.basename(event.cwd)
    if (event.session_title) pet.title = event.session_title
    pet.transcriptPath = event.transcript_path ?? pet.transcriptPath
    return pet
  }

  /** 優先挑牧場上還沒有的品種；全部都有了才重複 */
  private pickSpecies(): string {
    const pool = this.speciesIds.length > 0 ? this.speciesIds : ['025']
    const used = new Set([...this.pets.values()].map((p) => p.speciesId))
    const fresh = pool.filter((id) => !used.has(id))
    const from = fresh.length > 0 ? fresh : pool
    return from[Math.floor(Math.random() * from.length)]
  }

  private set(pet: PetState, mode: AgentMode, label: string | null): void {
    pet.mode = mode
    pet.label = label
  }

  private sweep(now: number): void {
    let changed = false
    for (const pet of this.pets.values()) {
      const quiet = now - pet.lastEventAt
      const limit = pet.mode === 'waiting' ? WAITING_STALE_MS : BUSY_STALE_MS
      if (pet.mode !== 'idle' && quiet > limit) {
        this.set(pet, 'idle', null)
        changed = true
      }
    }
    if (changed) this.emit(this.snapshot())
  }

  private async refreshMeta(pet: PetState): Promise<void> {
    if (pet.metaLoading) return
    pet.metaLoading = true
    pet.metaCheckedAt = Date.now()
    try {
      const meta = await this.resolveMeta(pet.sessionId, pet.transcriptPath)
      if (this.pets.get(pet.sessionId) !== pet || !meta.title || meta.title === pet.title) return
      pet.title = meta.title
      void this.save()
      this.emit(this.snapshot())
    } finally {
      pet.metaLoading = false
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.save()
    }, SAVE_THROTTLE_MS)
  }

  /** 先寫暫存檔再改名，寫到一半當掉也不會弄壞存檔；同時只寫一份 */
  private save(): Promise<void> {
    const records: PetRecord[] = [...this.pets.values()].map((p) => ({
      sessionId: p.sessionId,
      provider: p.provider,
      speciesId: p.speciesId,
      adoptedAt: p.adoptedAt,
      lastEventAt: p.lastEventAt,
      title: p.title,
      project: p.project,
    }))
    this.saving = this.saving.then(async () => {
      try {
        await mkdir(APP_DATA_DIR, { recursive: true })
        const tmp = `${ROSTER_FILE}.tmp`
        await writeFile(tmp, JSON.stringify({ version: 1, pets: records }, null, 2))
        await replaceFile(tmp, ROSTER_FILE)
      } catch (err) {
        console.error('[ranch] 存檔失敗', err)
      }
    })
    return this.saving
  }
}
