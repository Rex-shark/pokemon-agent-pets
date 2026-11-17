/**
 * Electron 主行程：開「牧場」視窗，同時開本機 HTTP 接 Claude Code hooks（hook-server.ts），
 * 整理成牧場快照（ranch-state.ts）後用 IPC 推給 renderer。
 *
 * 兩種顯示模式（設定記在 settings.json，選單切換；Windows 只有置頂）：
 * - 置頂（float，預設）：透明、無邊框、置頂的小牧場，放在上次的位置（window-place.ts），可以拖曳、點寵物。
 * - 桌布（wallpaper，2026-11-11 使用者要的）：type: 'desktop' 的視窗鋪滿選定的螢幕，在所有視窗與桌面圖示底下，
 *   透明背景（看得到使用者原本的桌布），收不到滑鼠與鍵盤；做法照 live2d-desktop。
 * 視窗類型不能在執行中改，切換模式時開一個新視窗、再關掉舊的。
 *
 * 控制選單（macOS 是 Dock 圖示的右鍵選單，Windows 是系統匣圖示；menu-host.ts）：牧場上的寵物（放生）、全部放生、
 * 桌布模式開關、桌布放在哪個螢幕、地圖（隨機或指定一張）、重新掃描模型、打開模型資料夾。
 *
 * 跟 OS 有關的差異（選單掛哪、有沒有桌布模式、存檔位置…）都在 electron/platform/，這裡只讀 PLATFORM。
 * Windows 沒有桌布模式（2026-11-13 使用者決定不做），選單上不會出現桌布的選項。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RANCH_CONFIG_CHANNEL,
  RANCH_DRAG_CHANNEL,
  RANCH_FRAME_CHANNEL,
  RANCH_MAP_LABELS,
  RANCH_MOUSE_THROUGH_CHANNEL,
  RANCH_UPDATE_CHANNEL,
  type RanchConfig,
  type RanchMapChoice,
  type RanchMapId,
  type RanchMode,
  type RanchUpdate,
  type SpeciesInfo,
} from '../shared/ranch-protocol'
import { APP_ORIGIN, registerSchemes, serveAppScheme, serveModelScheme } from './app-protocol'
import { startHookServer } from './hook-server'
import { createMenuHost } from './menu-host'
import { PLATFORM } from './platform'
import { readSettings, updateSettings, type RanchSettings } from './ranch-settings'
import { RanchState } from './ranch-state'
import { resolveSessionMeta } from './session-meta'
import { MODELS_DIR, scanSpecies, speciesName } from './species'
import {
  displayLabel,
  FLOAT_FRAME,
  initialBounds,
  refit,
  wallpaperDisplay,
  wallpaperFrame,
  watchDisplays,
} from './window-place'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RENDERER_DIR = path.join(__dirname, '../dist')
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
/**
 * 精靈球圖示（scripts/draw-icon.swift 畫的 build/icon.png）：開發模式拿來換 Dock 圖示、當系統匣圖示。
 * 打包後 Dock 用 build/icon.icns（electron-builder.yml 的 mac.icon）；系統匣用的 PNG 由 extraResources 複製到 resources/。
 */
const ICON_PNG = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png')

registerSchemes()

/** 多久沒有 hook 就睡覺（有睡覺動作的寶可夢才會睡）；測試時可以用環境變數 RANCH_SLEEP_AFTER_MS 改短 */
const SLEEP_AFTER_MS = Number(process.env.RANCH_SLEEP_AFTER_MS) || 5 * 60_000
/** 兩隻正面撞上時開打的機率；測試時可以用 RANCH_FIGHT_CHANCE=1 每次都打 */
const FIGHT_CHANCE = (() => {
  const v = Number(process.env.RANCH_FIGHT_CHANCE)
  return Number.isFinite(v) && process.env.RANCH_FIGHT_CHANCE !== undefined ? Math.min(Math.max(v, 0), 1) : 0.35
})()

const WEB_PREFERENCES: Electron.WebPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // 提醒音效：桌寵不會有使用者先點一下的機會，不能等手勢才允許播放
  autoplayPolicy: 'no-user-gesture-required',
}

function loadRenderer(win: BrowserWindow): void {
  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!)
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`)
    })
  } else {
    win.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

/** 套用「置頂」：打開時用 floating 層級並拉到最前面；關掉時變回一般視窗 */
function applyOnTop(win: BrowserWindow, onTop: boolean): void {
  if (onTop) {
    win.setAlwaysOnTop(true, 'floating')
    win.moveTop()
  } else {
    win.setAlwaysOnTop(false)
  }
}

/**
 * 小牧場視窗（float 模式）：大小與位置見 window-place.ts（上次放的螢幕與位置，放不下就等比例縮小）。
 * onTop：要不要一直在最上層（選單「置頂」，2026-11-13 使用者要的）；關掉時是一般視窗，會被其他視窗蓋住
 */
function createFloatWindow(onTop: boolean): BrowserWindow {
  const win = new BrowserWindow({
    ...initialBounds(),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: onTop,
    show: false,
    webPreferences: WEB_PREFERENCES,
    // 平台各自的選項（Windows：不佔工作列按鈕）
    ...PLATFORM.floatWindow,
  })
  applyOnTop(win, onTop)
  PLATFORM.setupFloatWindow(win)
  win.once('ready-to-show', () => win.showInactive())
  // 平常整片滑鼠穿透；forward 讓 renderer 還是收得到 mousemove，自己判斷游標是不是在牧場上
  win.setIgnoreMouseEvents(true, { forward: true })
  loadRenderer(win)
  return win
}

/** 桌布模式（只有 PLATFORM.wallpaper 的平台，目前是 macOS）：鋪滿選定螢幕的整個 bounds（含選單列、Dock 底下），桌面背景層、透明 */
function createWallpaperWindow(displayId: number | null): BrowserWindow {
  const win = new BrowserWindow({
    ...wallpaperDisplay(displayId).bounds,
    // 桌面背景層：在所有視窗與桌面圖示底下，不會拿到焦點、收不到滑鼠與鍵盤（Electron 文件：macOS 限定）
    type: 'desktop',
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // 選單列那一條也要蓋到，不然會被系統往下推
    enableLargerThanScreen: true,
    show: false,
    webPreferences: WEB_PREFERENCES,
  })
  PLATFORM.setupWallpaperWindow(win)
  win.once('ready-to-show', () => win.showInactive())
  loadRenderer(win)
  return win
}

function petLabel(title: string | null, project: string | null): string {
  const text = title ?? project ?? '（沒有標題）'
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

/** 選單上顯示的寵物（依認養順序） */
function menuPets(ranch: RanchState) {
  return ranch.list().sort((a, b) => a.adoptedAt - b.adoptedAt)
}

function menuPetLabel(p: ReturnType<RanchState['list']>[number]): string {
  return `${p.active ? '●' : '○'} ${speciesName(p.speciesId)} · ${p.provider === 'codex' ? 'Codex · ' : ''}${petLabel(p.title, p.project)}`
}

const DRAG_INTERVAL_MS = 16

app.whenReady().then(async () => {
  const menuHost = createMenuHost(ICON_PNG, isDev)
  if (!isDev) serveAppScheme(RENDERER_DIR)
  serveModelScheme(MODELS_DIR)

  let settings: RanchSettings = readSettings()
  /**
   * 這次啟動用哪一張地圖：設定是 random 就從所有地圖抽一張（2026-11-12 使用者「每次啟動地形用隨機」）。
   * 抽一次就固定到 App 結束：換模式、重新載入畫面都不會再換
   */
  const pickMap = (choice: RanchMapChoice): RanchMapId =>
    choice === 'random' ? RANCH_MAP_LABELS[Math.floor(Math.random() * RANCH_MAP_LABELS.length)].id : choice
  let launchMap = pickMap(settings.map)
  let species: SpeciesInfo[] = await scanSpecies()

  const createWindow = () =>
    settings.mode === 'wallpaper' ? createWallpaperWindow(settings.wallpaperDisplay) : createFloatWindow(settings.alwaysOnTop)
  /** 目前的牧場視窗；切換模式時會換成新的，所以下面的處理一律看這個變數，不要記住舊的 */
  let win = createWindow()

  ipcMain.handle(
    RANCH_CONFIG_CHANNEL,
    (): RanchConfig => ({
      mode: settings.mode,
      frame: settings.mode === 'wallpaper' ? wallpaperFrame(wallpaperDisplay(settings.wallpaperDisplay)) : FLOAT_FRAME,
      map: launchMap,
      species,
      modelsDir: MODELS_DIR,
      sleepAfterMs: SLEEP_AFTER_MS,
      fightChance: FIGHT_CHANCE,
    }),
  )

  // ── 滑鼠穿透與拖曳（只有置頂模式會送；只認目前這個視窗送來的訊息） ──
  let dragTimer: NodeJS.Timeout | undefined
  const stopDrag = () => {
    clearInterval(dragTimer)
    dragTimer = undefined
  }
  ipcMain.on(RANCH_MOUSE_THROUGH_CHANNEL, (event, through: unknown) => {
    if (event.sender !== win.webContents || settings.mode !== 'float' || typeof through !== 'boolean') return
    win.setIgnoreMouseEvents(through, { forward: true })
  })
  ipcMain.on(RANCH_DRAG_CHANNEL, (event, phase: unknown) => {
    if (event.sender !== win.webContents || settings.mode !== 'float') return
    stopDrag()
    // 放開：拖到別的螢幕的話換成適合那個螢幕的大小，並記住位置
    if (phase !== 'start') return refit(win)
    const target = win
    const cursor = screen.getCursorScreenPoint()
    const { x, y, width, height } = target.getBounds()
    dragTimer = setInterval(() => {
      if (target.isDestroyed()) return stopDrag()
      const now = screen.getCursorScreenPoint()
      // 用 setBounds 連同大小一起給：Windows 拖過縮放比例不同的螢幕時，只 setPosition 會讓視窗越拖越大
      target.setBounds({ x: x + now.x - cursor.x, y: y + now.y - cursor.y, width, height })
    }, DRAG_INTERVAL_MS)
  })

  let ranch: RanchState
  const send = (update: RanchUpdate) => {
    if (!win.isDestroyed()) win.webContents.send(RANCH_UPDATE_CHANNEL, update)
    refreshMenu()
  }
  ranch = new RanchState(send, resolveSessionMeta)
  await ranch.load()
  ranch.setSpecies(species.map((s) => s.id))

  /** 新視窗載完（開發時存檔、換模式、重新掃描都會）補發目前的狀態，不然寵物會停在待機直到下一個事件 */
  const attach = (w: BrowserWindow) => {
    w.webContents.on('did-finish-load', () => {
      if (w === win) send(ranch.snapshot())
    })
  }
  attach(win)

  /** 換模式、換桌布螢幕：先開新視窗再關舊的（先關的話 window-all-closed 會讓 App 結束） */
  async function applySettings(change: Partial<RanchSettings>): Promise<void> {
    settings = await updateSettings(change)
    stopDrag()
    const old = win
    win = createWindow()
    attach(win)
    old.destroy()
    refreshMenu(true)
  }

  async function rescan(): Promise<void> {
    species = await scanSpecies()
    ranch.setSpecies(species.map((s) => s.id))
    // 重新載入畫面讓 renderer 拿新的品種清單；did-finish-load 會補發快照
    win.webContents.reload()
  }

  /**
   * 螢幕插拔、解析度改變：置頂模式重新套用大小與位置；桌布模式重新鋪滿（選的螢幕拔掉 → 主螢幕；接回來 → 搬回去）。
   * 桌布模式以前在這裡整頁 reload（為了重拿跟 Dock、選單列高度有關的取景），寵物會閃一下、全部換位置；
   * Dock 換螢幕、把視窗縮到 Dock、進出全螢幕都會觸發（2026-11-13 使用者：「我把 IDEA 縮到 Dock 就會閃一下」「好改」）。
   * 現在只把新的取景送給 renderer，原地重新取景；視窗大小變了 renderer 自己跟著 resize。
   */
  watchDisplays(() => {
    if (win.isDestroyed()) return
    if (settings.mode === 'float') {
      refit(win)
    } else {
      const display = wallpaperDisplay(settings.wallpaperDisplay)
      const cur = win.getBounds()
      const next = display.bounds
      if (next.x !== cur.x || next.y !== cur.y || next.width !== cur.width || next.height !== cur.height) win.setBounds(next)
      win.webContents.send(RANCH_FRAME_CHANNEL, wallpaperFrame(display))
    }
    refreshMenu(true)
  })

  /**
   * 放生前確認（第一個按鈕是確定，預設停在「取消」）。桌布視窗收不到滑鼠，確認框不能附在它上面，改成獨立的對話框
   */
  async function confirm(ok: string, message: string, detail: string): Promise<boolean> {
    // 從 Dock／系統匣選單點的，App 不在前景：先叫到前面，確認框才看得到、按得到
    app.focus({ steal: true })
    const options: Electron.MessageBoxOptions = { type: 'question', buttons: [ok, '取消'], defaultId: 1, cancelId: 1, message, detail }
    const { response } = settings.mode === 'float' ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return response === 0
  }

  function confirmRelease(p: ReturnType<RanchState['list']>[number]): Promise<boolean> {
    return confirm(
      '放生',
      `要放生 ${speciesName(p.speciesId)} 嗎？`,
      `牠是「${petLabel(p.title, p.project)}」這個 session 的寵物。放生後同一個 session 再有動靜時，會重新隨機認養一隻。`,
    )
  }

  /** 全部放生（2026-11-13 使用者「新增一個功能 全部放生」）：一次清空，所以一定要確認 */
  function confirmReleaseAll(pets: ReturnType<RanchState['list']>): Promise<boolean> {
    const online = pets.filter((p) => p.active).length
    return confirm(
      '全部放生',
      `要把牧場上的 ${pets.length} 隻寶可夢全部放生嗎？`,
      online > 0
        ? `其中 ${online} 隻的 session 還在線上，牠們的 session 再有動靜時，會各自重新隨機認養一隻。`
        : '放生後牧場會空下來，之後有 session 開始動作時才會再認養。',
    )
  }

  function buildMenu(): Menu {
    const pets = menuPets(ranch)
    const petItems: Electron.MenuItemConstructorOptions[] =
      pets.length === 0
        ? [{ label: '（還沒有寵物：開一個 Claude session 就會來）', enabled: false }]
        : pets.map((p) => ({
            label: menuPetLabel(p),
            submenu: [
              {
                label: '放生…',
                click: async () => {
                  if (await confirmRelease(p)) ranch.release(p.sessionId)
                },
              },
            ],
          }))
    const target = wallpaperDisplay(settings.wallpaperDisplay)
    const setMode = (mode: RanchMode) => () => {
      if (mode !== settings.mode) void applySettings({ mode })
    }
    // 全部放生跟寵物清單用分隔線隔開，免得點寵物時誤按
    const releaseAllItems: Electron.MenuItemConstructorOptions[] =
      pets.length === 0
        ? []
        : [
            { type: 'separator' },
            {
              label: '全部放生…',
              click: async () => {
                // 確認框開著的時候可能又有新寵物進來：放生的是按下確定那一刻牧場上的全部
                if (await confirmReleaseAll(menuPets(ranch))) ranch.releaseAll()
              },
            },
          ]
    return Menu.buildFromTemplate([
      { label: `牧場上的寵物（${pets.length}）`, enabled: false },
      ...petItems,
      ...releaseAllItems,
      ...(PLATFORM.wallpaper ? wallpaperItems() : []),
      { type: 'separator' },
      // 置頂開關（只有小牧場模式；桌布模式本來就在最底層）。存在 settings.json，下次開也一樣
      ...(settings.mode === 'float'
        ? [
            {
              label: '置頂',
              type: 'checkbox' as const,
              checked: settings.alwaysOnTop,
              click: (item: Electron.MenuItem) => {
                const onTop = item.checked
                void updateSettings({ alwaysOnTop: onTop }).then((s) => {
                  settings = s
                  if (!win.isDestroyed() && settings.mode === 'float') applyOnTop(win, onTop)
                  refreshMenu(true)
                })
              },
            },
          ]
        : []),
      {
        label: '地圖',
        submenu: [
          {
            // 隨機：只記下來，這次的地圖不換（下次啟動才抽）
            label: `隨機（每次啟動換一張・這次：${RANCH_MAP_LABELS.find((m) => m.id === launchMap)?.label ?? ''}）`,
            type: 'radio' as const,
            checked: settings.map === 'random',
            click: () => {
              if (settings.map === 'random') return
              void updateSettings({ map: 'random' }).then((s) => {
                settings = s
                refreshMenu(true)
              })
            },
          },
          // 跟下面幾張地圖同一組單選（中間不能放分隔線，不然會拆成兩組）
          ...RANCH_MAP_LABELS.map(({ id, label }) => ({
            label,
            type: 'radio' as const,
            checked: settings.map === id,
            click: () => {
              if (id === settings.map) return
              // 固定用這張：存起來再重新載入畫面（renderer 重拿設定、照新地圖重蓋場地，寵物重新找位置；did-finish-load 會補發快照）
              void updateSettings({ map: id }).then((s) => {
                settings = s
                const changed = launchMap !== id
                launchMap = id
                if (changed && !win.isDestroyed()) win.webContents.reload()
                refreshMenu(true)
              })
            },
          })),
        ],
      },
      { type: 'separator' },
      { label: '重新掃描模型', click: () => void rescan() },
      { label: '打開模型資料夾', click: () => void shell.openPath(MODELS_DIR) },
      // 系統匣沒有系統給的「結束」，自己放一個（Dock 本來就有）
      ...(menuHost.needsQuitItem ? [{ type: 'separator' as const }, { label: '結束寶可夢牧場', click: () => app.quit() }] : []),
    ])

    /** 置頂／桌布切換、桌布放在哪個螢幕（只有支援桌布模式的平台） */
    function wallpaperItems(): Electron.MenuItemConstructorOptions[] {
      return [
        { type: 'separator' },
        // radio 會跟相鄰的 radio 併成一組：模式這兩個前後用分隔線隔開
        { label: '置頂小牧場', type: 'radio', checked: settings.mode === 'float', click: setMode('float') },
        { label: '桌布模式', type: 'radio', checked: settings.mode === 'wallpaper', click: setMode('wallpaper') },
        {
          label: '桌布放在哪個螢幕',
          submenu: screen.getAllDisplays().map((display, i) => ({
            label: displayLabel(display, i),
            type: 'radio' as const,
            checked: display.id === target.id,
            click: () => {
              // 沒在桌布模式時只記下來，切到桌布模式時才用
              if (settings.mode === 'wallpaper') void applySettings({ wallpaperDisplay: display.id })
              else void updateSettings({ wallpaperDisplay: display.id }).then((s) => {
                settings = s
                refreshMenu(true)
              })
            },
          })),
        },
      ]
    }
  }

  /**
   * 🔴 只有選單內容變了（寵物增減、標題、在線與否）才重建（Dock 與系統匣都一樣）：開著的 session 每幾秒就有 hook 事件，
   * 以前每個事件都重建，使用者在 Dock 選單裡點到一半選單就被換掉，「放生…」按了沒反應（2026-11-11 使用者回報、已重現）。
   * 換模式、換螢幕、螢幕增減時用 force 強制重建。另外留著最近幾份舊選單不讓它被回收。
   */
  let menuKey = ''
  const recentMenus: Menu[] = []
  function refreshMenu(force = false): void {
    const key = menuPets(ranch).map((p) => `${p.sessionId}|${menuPetLabel(p)}`).join('\n')
    if (!force && key === menuKey) return
    menuKey = key
    const menu = buildMenu()
    recentMenus.push(menu)
    if (recentMenus.length > 5) recentMenus.shift()
    menuHost.setMenu(menu)
  }
  refreshMenu(true)

  const server = startHookServer((event) => {
    if (isDev) {
      const agent = event.agent_id ? ` [${event.agent_type ?? 'subagent'}]` : ''
      console.log(`[hook] ${event.session_id.slice(0, 8)}${agent} ${event.hook_event_name} ${event.tool_name ?? ''}`)
    }
    ranch.handle(event)
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    // 先把 lastEventAt 寫進存檔再結束
    e.preventDefault()
    quitting = true
    server.close()
    void ranch.dispose().finally(() => app.quit())
  })
})

app.on('window-all-closed', () => app.quit())
