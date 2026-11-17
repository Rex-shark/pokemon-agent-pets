/**
 * 查 Claude session 的標題與群組（hook 事件裡沒有這兩個欄位）。
 *
 * 來源都是別的程式的內部檔案，格式沒有文件、隨 App 或 CLI 更新可能改：
 * **一律唯讀、讀不到就回 null、絕不寫入**。
 *
 * - 標題：桌面版 session 檔的 `title`（側欄看到的那個）→ 沒有就讀對話紀錄（hook 的 transcript_path）
 *   檔尾最後一筆 `custom-title`。終端機開的 session 只有後者，而且要改過名或自動取過名才有。
 * - 群組：桌面版 `claude_desktop_config.json` 的側欄群組。只有桌面版的 session 有；終端機開的是 null。
 *
 * 對應關係：hook 的 session_id = 桌面版 session 檔的 cliSessionId；
 * 檔案在 claude-code-sessions/<scope>/local_*.json，scope（兩層目錄）也是設定檔裡群組的 key。
 */
import { open, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { isInside, PLATFORM } from './platform'

export interface SessionMeta {
  title: string | null
  group: string | null
}

/** Claude 桌面版的資料夾依 OS 不同（electron/platform/）；沒有桌面版的平台就只讀對話紀錄 */
const APP_DIR = PLATFORM.claudeDesktopDir
const SESSIONS_DIR = APP_DIR ? path.join(APP_DIR, 'claude-code-sessions') : null
const CONFIG_FILE = APP_DIR ? path.join(APP_DIR, 'claude_desktop_config.json') : null
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

/** 對話紀錄可能好幾 MB，只讀檔尾；標題每一輪都會重寫一筆，檔尾一定找得到最新的 */
const TRANSCRIPT_TAIL_BYTES = 256 * 1024
/** 找不到某個 session 時重新掃描桌面版 session 檔的最短間隔 */
const RESCAN_INTERVAL_MS = 5000

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

async function readJson(file: string): Promise<JsonRecord | null> {
  try {
    return asRecord(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return null
  }
}

/** cliSessionId → 桌面版 session 檔路徑 */
const desktopFiles = new Map<string, string>()
/** 已經解析過的檔案（新 session 才會多出新檔，舊的不用重讀） */
const scannedFiles = new Set<string>()
let lastScanAt = 0

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function scanDesktopSessions(): Promise<void> {
  lastScanAt = Date.now()
  if (!SESSIONS_DIR) return
  for (const org of await listDir(SESSIONS_DIR)) {
    for (const account of await listDir(path.join(SESSIONS_DIR, org))) {
      const dir = path.join(SESSIONS_DIR, org, account)
      for (const name of await listDir(dir)) {
        if (!name.startsWith('local_') || !name.endsWith('.json')) continue
        const file = path.join(dir, name)
        if (scannedFiles.has(file)) continue
        scannedFiles.add(file)
        const cliSessionId = asString((await readJson(file))?.cliSessionId)
        if (cliSessionId) desktopFiles.set(cliSessionId, file)
      }
    }
  }
}

interface DesktopSession {
  localId: string
  scope: string
  title: string | null
}

async function readDesktopSession(cliSessionId: string): Promise<DesktopSession | null> {
  if (!desktopFiles.has(cliSessionId) && Date.now() - lastScanAt > RESCAN_INTERVAL_MS) {
    await scanDesktopSessions()
  }
  const file = desktopFiles.get(cliSessionId)
  if (!file || !SESSIONS_DIR) return null
  const data = await readJson(file)
  const localId = asString(data?.sessionId)
  if (!data || !localId) return null
  return {
    localId,
    scope: path.relative(SESSIONS_DIR, path.dirname(file)).split(path.sep).join('/'),
    title: asString(data.title),
  }
}

async function readGroup(session: DesktopSession): Promise<string | null> {
  if (!CONFIG_FILE) return null
  const prefs = asRecord(asRecord((await readJson(CONFIG_FILE))?.preferences)?.epitaxyPrefs)
  const scope = asRecord(asRecord(prefs?.['dframe-group-scopes'])?.[session.scope])
  const groupId = asString(asRecord(scope?.assignments)?.[`code:${session.localId}`])
  if (!groupId) return null
  // 群組名稱在兩份清單裡都有可能出現：群組本身與側欄的區段
  const sections = asRecord(asRecord(prefs?.['dframe-code-sections'])?.[session.scope])?.sections
  for (const list of [scope?.groups, sections]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const entry = asRecord(item)
      if (entry?.id === groupId) return asString(entry.name)
    }
  }
  return null
}

async function readTranscriptTitle(transcriptPath: string): Promise<string | null> {
  // transcript_path 來自 POST 進來的資料：只讀 ~/.claude/projects 底下的 .jsonl，不碰其他檔案
  const resolved = path.resolve(transcriptPath)
  // Windows 的磁碟代號大小寫可能不一致（C: 與 c:），isInside 會依平台決定要不要分大小寫
  if (!isInside(PROJECTS_DIR, resolved) || !resolved.toLowerCase().endsWith('.jsonl')) return null
  let handle
  try {
    handle = await open(resolved, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"custom-title"')) continue
      try {
        const title = asString(asRecord(JSON.parse(lines[i]))?.customTitle)
        if (title) return title
      } catch {
        // 檔尾第一行可能被切到一半，跳過
      }
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

export async function resolveSessionMeta(sessionId: string, transcriptPath: string | null): Promise<SessionMeta> {
  const desktop = await readDesktopSession(sessionId)
  const title = desktop?.title ?? (transcriptPath ? await readTranscriptTitle(transcriptPath) : null)
  const group = desktop ? await readGroup(desktop) : null
  return { title, group }
}
