/**
 * 接收 Claude Code 與 Codex 轉接器事件的本機 HTTP 服務。
 *
 * repo 根目錄的 hooks/pet-hook.mjs（macOS 也可以用 pet-hook.sh）轉送 Claude Code 事件；hooks/codex-hook.py 過濾、轉換 Codex 事件後 POST 到 /hook。
 * 這裡只取用得到的欄位（HookEvent），其餘（提示文字、tool_input、Claude 的回覆等）讀完就丟，不保存也不轉給 renderer。
 * 唯一的例外是對話框上的簡短說明（toolDetail）：從 tool_input 挑一個看不出隱私的欄位、截短後留下，其餘照樣丟掉。
 *
 * 安全：只聽 127.0.0.1；帶 Origin 標頭的請求一律拒絕（瀏覽器裡的網頁跨站 POST 一定會帶，curl 不會），
 * 避免開著的網頁冒充 Claude 來改寵物的狀態。
 */
import http from 'node:http'
import type { AgentProvider } from '../shared/ranch-protocol'
import { baseName } from './platform'

export const HOOK_PORT = Number(process.env.PET_HOOK_PORT) || 47821

/** 單一事件的上限：PreToolUse 的 Write 會帶整個檔案內容，給寬一點；超過就斷線 */
const MAX_BODY_BYTES = 10 * 1024 * 1024

/** Claude Code hook 事件裡我們用得到的欄位（其他欄位見 Claude Code 的 hooks 文件） */
export interface HookEvent {
  /** 舊的 Claude hook 沒有這個欄位，預設 claude */
  provider?: AgentProvider
  session_id: string
  hook_event_name: string
  /** 由轉接器明確提供的顯示名稱；不從提示文字推測 */
  session_title?: string
  tool_name?: string
  cwd?: string
  /** 對話紀錄；session-meta.ts 從檔尾讀標題 */
  transcript_path?: string
  /** 子代理裡發生的事件才有（SubagentStart/Stop、子代理的 PreToolUse/PostToolUse） */
  agent_id?: string
  agent_type?: string
  /** PostToolUseFailure：使用者按 Esc 中斷（不算出錯） */
  is_interrupt?: boolean
  /** 工具的簡短說明（toolDetail 從 tool_input 挑出來、截短過）；不是 hook 原本的欄位 */
  detail?: string
}

/** 簡短說明最多幾個字，多的用「…」 */
const DETAIL_MAX = 20

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function field(input: Record<string, unknown>, key: string): string | undefined {
  return optionalString(input[key])
}

/**
 * 對話框上的簡短說明（2026-10-28 使用者要求：只挑安全、沒隱私的，前面幾個字、後面用…）：
 * - 讀檔、改檔：只取檔名（不取路徑）
 * - 跑指令、派小幫手：Claude 自己寫的 description（不取指令本身，指令裡可能有 token）；
 *   子代理常常不寫 description，這時只取程式名稱＋純英文小寫的子指令（git log、npm run），參數、路徑一律不取
 * - 抓網頁：只取網域
 * - 問問題：問題的短標題 header
 * - Skill：skill 名稱
 * 不取：提示文字、搜尋關鍵字、Grep／Glob 的搜尋字串、計畫內容、檔案內容。
 */
/** 「cd x && FOO=1 /usr/bin/git log -5」→「git log」：跳過 cd 與環境變數，程式只留檔名（C:\…\git.exe 也是「git」） */
function commandName(command: string | undefined): string | undefined {
  if (!command) return undefined
  const segment = command.split(/&&|;|\|\|/).map((part) => part.trim()).find((part) => part && !/^cd(\s|$)/.test(part))
  const words = (segment ?? '').split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  const program = words[0] ? baseName(words[0].replace(/^["']|["']$/g, '')).replace(/\.(exe|cmd|bat|ps1)$/i, '') : undefined
  if (!program || !/^[\w.+-]+$/.test(program)) return undefined
  const sub = words[1]
  return sub && /^[a-z][a-z-]*$/.test(sub) ? `${program} ${sub}` : program
}

function toolDetail(tool: string | undefined, raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const input = raw as Record<string, unknown>
  let detail: string | undefined
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': {
      // 只取檔名：Windows 的路徑是反斜線，用 split('/') 會把整條路徑露出來
      const file = field(input, 'file_path') ?? field(input, 'notebook_path')
      detail = file ? baseName(file) : undefined
      break
    }
    case 'Bash':
      detail = field(input, 'description') ?? commandName(field(input, 'command'))
      break
    case 'Task':
    case 'Agent':
      detail = field(input, 'description')
      break
    case 'WebFetch': {
      const url = field(input, 'url')
      try {
        detail = url ? new URL(url).hostname : undefined
      } catch {
        detail = undefined
      }
      break
    }
    case 'AskUserQuestion': {
      const questions = input.questions
      const first: unknown = Array.isArray(questions) ? questions[0] : undefined
      detail = typeof first === 'object' && first !== null ? field(first as Record<string, unknown>, 'header') : undefined
      break
    }
    case 'Skill':
      detail = field(input, 'skill')
      break
  }
  const text = detail?.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  const chars = Array.from(text)
  return chars.length > DETAIL_MAX ? `${chars.slice(0, DETAIL_MAX).join('')}…` : text
}

export function parseHookEvent(body: string): HookEvent | null {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const fields = data as Record<string, unknown>
  const { session_id, hook_event_name } = fields
  if (typeof session_id !== 'string' || !session_id.trim() || typeof hook_event_name !== 'string' || !hook_event_name.trim()) return null
  if (fields.provider !== undefined && fields.provider !== 'claude' && fields.provider !== 'codex') return null
  const provider = fields.provider === 'codex' ? 'codex' : 'claude'
  const title = optionalString(fields.session_title)?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  const tool_name = optionalString(fields.tool_name)
  return {
    provider,
    session_id,
    hook_event_name,
    session_title: title ? Array.from(title).slice(0, 80).join('') : undefined,
    tool_name,
    detail: toolDetail(tool_name, fields.tool_input),
    cwd: optionalString(fields.cwd),
    // Codex 的 transcript 格式不是穩定介面，也不能交給 Claude 的標題解析器。
    transcript_path: provider === 'claude' ? optionalString(fields.transcript_path) : undefined,
    agent_id: optionalString(fields.agent_id),
    agent_type: optionalString(fields.agent_type),
    is_interrupt: fields.is_interrupt === true,
  }
}

export function startHookServer(onEvent: (event: HookEvent) => void, port = HOOK_PORT): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook' || req.headers.origin !== undefined) {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end()
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      const event = parseHookEvent(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(event ? 204 : 400).end()
      if (event) onEvent(event)
    })
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    // port 被占用（例如開了第二個桌寵）：牧場照樣顯示，只是收不到 hooks
    console.error(`[hook-server] 無法監聽 127.0.0.1:${port}：${err.code ?? err.message}`)
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`[hook-server] 監聽 http://127.0.0.1:${(server.address() as { port: number }).port}/hook`)
  })
  return server
}
