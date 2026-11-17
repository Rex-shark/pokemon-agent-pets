/**
 * App 設定（settings.json，在 APP_DATA_DIR）：顯示模式、桌布放在哪個螢幕、用哪一張地圖、小牧場要不要置頂。
 * 讀不到或格式不對就用預設值；寫入時只改傳進來的欄位。
 * 2026-11-12 視角的選擇拿掉了（只剩等角）：舊檔裡的 view 讀的時候忽略；舊的地圖 id（全背景等）也不認，改回預設的隨機。
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { isRanchMapChoice, type RanchMapChoice, type RanchMode } from '../shared/ranch-protocol'
import { PLATFORM } from './platform'
import { APP_DATA_DIR } from './species'

const SETTINGS_FILE = path.join(APP_DATA_DIR, 'settings.json')

export interface RanchSettings {
  /** float：置頂的小牧場（預設）；wallpaper：桌布模式（桌面背景層、鋪滿螢幕） */
  mode: RanchMode
  /** 桌布放在哪個螢幕（Display.id）；null = 主螢幕 */
  wallpaperDisplay: number | null
  /** 牧場地圖（shared/ranch-protocol.ts 的 RANCH_MAP_LABELS），或 random：每次啟動抽一張（預設） */
  map: RanchMapChoice
  /** 小牧場要不要一直在最上層（選單「置頂」）；預設 true，關掉時是一般視窗、會被其他視窗蓋住 */
  alwaysOnTop: boolean
}

const DEFAULTS: RanchSettings = { mode: 'float', wallpaperDisplay: null, map: 'random', alwaysOnTop: true }

export function readSettings(): RanchSettings {
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as Record<string, unknown>
    return {
      // 沒有桌布模式的平台（Windows）一律置頂小牧場
      mode: data.mode === 'wallpaper' && PLATFORM.wallpaper ? 'wallpaper' : 'float',
      wallpaperDisplay: typeof data.wallpaperDisplay === 'number' ? data.wallpaperDisplay : null,
      map: isRanchMapChoice(data.map) ? data.map : DEFAULTS.map,
      // 舊的設定檔沒有這個欄位：照舊置頂
      alwaysOnTop: typeof data.alwaysOnTop === 'boolean' ? data.alwaysOnTop : DEFAULTS.alwaysOnTop,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function updateSettings(change: Partial<RanchSettings>): Promise<RanchSettings> {
  const next = { ...readSettings(), ...change }
  try {
    await mkdir(APP_DATA_DIR, { recursive: true })
    await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('[ranch] 設定存檔失敗', err)
  }
  return next
}
