/** macOS 的平台設定（原本的版本：Dock 選單、桌布模式） */
import os from 'node:os'
import path from 'node:path'

import type { PlatformProfile } from './types'

const SUPPORT = path.join(os.homedir(), 'Library', 'Application Support')

export const darwin: PlatformProfile = {
  id: 'darwin',
  label: 'macOS',
  appDataDir: path.join(SUPPORT, 'Pokemon Ranch Pets'),
  claudeDesktopDir: path.join(SUPPORT, 'Claude'),
  menuHost: 'dock',
  menuName: 'Dock 選單',
  wallpaper: true,
  floatWindow: {},
  setupFloatWindow(win) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  },
  setupWallpaperWindow(win) {
    // 每個桌面（Spaces）都有；🔴 skipTransformProcessType 不能拿掉，拿掉 Dock 圖示會消失（沒地方結束程式、換模式）
    win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })
  },
  caseInsensitivePaths: false,
}
