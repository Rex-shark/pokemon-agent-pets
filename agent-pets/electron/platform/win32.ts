/**
 * Windows 的平台設定（2026-11-13 加的）。
 *
 * - 沒有 Dock：控制選單改放系統匣圖示（右鍵、左鍵都會打開），選單最後自己加「結束」。
 * - 沒有桌布模式：Windows 要把視窗塞進 Explorer 的 WorkerW 底下才能在桌面圖示後面，要原生呼叫、容易壞，使用者決定不做。
 * - 置頂小牧場不佔工作列按鈕（skipTaskbar），像桌寵一樣只有系統匣圖示。
 */
import os from 'node:os'
import path from 'node:path'

import type { PlatformProfile } from './types'

/** %APPDATA%（Roaming）；Electron 的 app.getPath('appData') 也是這個 */
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')

export const win32: PlatformProfile = {
  id: 'win32',
  label: 'Windows',
  appDataDir: path.join(APPDATA, 'Pokemon Ranch Pets'),
  claudeDesktopDir: path.join(APPDATA, 'Claude'),
  menuHost: 'tray',
  menuName: '系統匣選單',
  wallpaper: false,
  floatWindow: { skipTaskbar: true },
  setupFloatWindow() {},
  setupWallpaperWindow() {},
  caseInsensitivePaths: true,
}
