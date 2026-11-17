/**
 * 這台電腦用哪一份平台設定（說明見 types.ts）。
 * 測試或除錯時可以用環境變數 PET_PLATFORM=darwin|win32|linux 強制指定（只換設定檔，不會真的變成別的 OS）。
 */
import path from 'node:path'

import { darwin } from './darwin'
import { linux } from './linux'
import type { PlatformId, PlatformProfile } from './types'
import { win32 } from './win32'

export type { PlatformId, PlatformProfile } from './types'

const PROFILES: Record<PlatformId, PlatformProfile> = { darwin, win32, linux }

function pick(): PlatformProfile {
  const forced = process.env.PET_PLATFORM as PlatformId | undefined
  if (forced && forced in PROFILES) return PROFILES[forced]
  return process.platform === 'darwin' ? darwin : process.platform === 'win32' ? win32 : linux
}

export const PLATFORM: PlatformProfile = pick()

/** child 是不是在 parent 資料夾底下（不含 parent 本身）；Windows 不分大小寫 */
export function isInside(parent: string, child: string): boolean {
  const norm = (p: string) => {
    const resolved = path.resolve(p)
    return PLATFORM.caseInsensitivePaths ? resolved.toLowerCase() : resolved
  }
  const rel = path.relative(norm(parent), norm(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** 路徑最後一段（檔名）：不管是 / 還是 \ 分隔都切得開（hook 事件裡的路徑可能來自任何 OS） */
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? ''
}
