/**
 * 控制選單掛在哪裡（electron/platform/ 的 menuHost 決定）：
 * - dock（macOS）：Dock 圖示的右鍵選單；系統本來就有「結束」。
 * - tray（Windows、Linux）：系統匣圖示，右鍵或左鍵都打開同一份選單；選單最後要自己加「結束」（needsQuitItem）。
 *
 * 選單內容由 main.ts 的 buildMenu 產生，兩種掛法共用。
 */
import { app, Menu, nativeImage, Tray } from 'electron'

import { PLATFORM } from './platform'

export interface MenuHost {
  setMenu(menu: Menu): void
  /** 選單最後要不要加「結束」 */
  readonly needsQuitItem: boolean
}

/** 精靈球圖示（1024×1024 PNG）縮成系統匣用的大小：100%、150%、200% 縮放各一張，讓 Windows 自己挑 */
function trayImage(iconPath: string): Electron.NativeImage {
  const source = nativeImage.createFromPath(iconPath)
  if (source.isEmpty()) return source
  const image = nativeImage.createEmpty()
  for (const [scaleFactor, size] of [[1, 16], [1.5, 24], [2, 32]] as const) {
    const resized = source.resize({ width: size, height: size, quality: 'best' })
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: resized.toPNG() })
  }
  return image
}

/** 系統匣圖示要一直留著引用，不然被回收後圖示會自己消失 */
let tray: Tray | null = null

export function createMenuHost(iconPath: string, isDev: boolean): MenuHost {
  if (PLATFORM.menuHost === 'dock') {
    // 開發模式跑的是 Electron 本身，要自己換掉預設圖示；打包後用 electron-builder.yml 的 mac.icon
    if (isDev) app.dock?.setIcon(iconPath)
    return { needsQuitItem: false, setMenu: (menu) => app.dock?.setMenu(menu) }
  }

  tray = new Tray(trayImage(iconPath))
  tray.setToolTip(isDev ? '寶可夢牧場（開發模式）' : '寶可夢牧場')
  let current: Menu | null = null
  // Windows 習慣左鍵也能叫出選單（右鍵由 setContextMenu 處理）
  tray.on('click', () => {
    if (current) tray?.popUpContextMenu(current)
  })
  return {
    needsQuitItem: true,
    setMenu(menu) {
      current = menu
      tray?.setContextMenu(menu)
    },
  }
}
