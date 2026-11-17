/**
 * 平台設定檔的形狀（2026-11-13 使用者：做 Windows 版，模組、地圖共用，「抽出設定檔根據不同 os 使用」）。
 *
 * 跟作業系統有關的差異都收在 electron/platform/ 底下，一個 OS 一份（darwin.ts、win32.ts、linux.ts），
 * index.ts 依 process.platform 挑一份。其他程式只讀 PLATFORM，不要自己判斷 process.platform。
 *
 * 🔴 這裡不能 import electron 的執行期東西（只能 import type）：展示網站（showcase/vite.config.ts）
 * 在一般 Node 裡經 species.ts 讀到這份設定。
 */
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export type PlatformId = 'darwin' | 'win32' | 'linux'

export interface PlatformProfile {
  id: PlatformId
  /** 顯示用的平台名稱 */
  label: string
  /** 存檔目錄（ranch.json、window.json、settings.json）；PET_DATA_DIR 會蓋過 */
  appDataDir: string
  /** Claude 桌面版的資料夾（讀 session 標題與側欄群組，唯讀）；這個平台沒有就 null */
  claudeDesktopDir: string | null
  /**
   * 控制選單掛在哪裡：
   * - dock：macOS Dock 圖示的右鍵選單（系統自己有「結束」）
   * - tray：系統匣圖示的右鍵／左鍵選單（要自己放「結束」）
   */
  menuHost: 'dock' | 'tray'
  /** 選單在使用者口中叫什麼（確認框、提示文字用） */
  menuName: string
  /** 有沒有桌布模式（鋪在桌面圖示底下）；沒有的話設定裡存的是 wallpaper 也當成 float */
  wallpaper: boolean
  /** 置頂小牧場視窗的額外選項（跟共用的選項合併） */
  floatWindow: BrowserWindowConstructorOptions
  /** 置頂小牧場視窗建好之後要做的事（例如 macOS 的「每個桌面都有」） */
  setupFloatWindow(win: BrowserWindow): void
  /** 桌布模式視窗建好之後要做的事；wallpaper 為 false 的平台不會呼叫 */
  setupWallpaperWindow(win: BrowserWindow): void
  /** 檔案路徑比對要不要不分大小寫（Windows 的磁碟代號 C: 與 c: 是同一個） */
  caseInsensitivePaths: boolean
}
