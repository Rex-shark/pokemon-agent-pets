/** Linux 的平台設定：沒有測過，只求能開（系統匣選單、沒有桌布模式、XDG 設定目錄） */
import os from 'node:os'
import path from 'node:path'

import type { PlatformProfile } from './types'

const CONFIG = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')

export const linux: PlatformProfile = {
  id: 'linux',
  label: 'Linux',
  appDataDir: path.join(CONFIG, 'Pokemon Ranch Pets'),
  claudeDesktopDir: path.join(CONFIG, 'Claude'),
  menuHost: 'tray',
  menuName: '系統匣選單',
  wallpaper: false,
  floatWindow: { skipTaskbar: true },
  setupFloatWindow() {},
  setupWallpaperWindow() {},
  caseInsensitivePaths: false,
}
