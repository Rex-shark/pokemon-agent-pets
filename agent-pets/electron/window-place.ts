/**
 * 牧場視窗放在哪個螢幕、多大。
 *
 * - 大小：設計尺寸 RANCH_SIZE，放不下就等比例縮到所在螢幕工作區的 95%（2026-11-11：外接螢幕開 HiDPI 時
 *   只有 960×540 點，原本的視窗會超出螢幕、下緣被切掉）。等比例縮，renderer 的鏡頭取景比例不變。
 * - 位置：記住「視窗下緣的中點」在哪（window.json），下次開在同一個螢幕的同一個地方；那個螢幕拔掉了就回到主螢幕右下角。
 * - 拖曳放開、螢幕增減或解析度改變時重新套用：拖到另一個螢幕會自動換成適合那個螢幕的大小，並且整個留在工作區內。
 * - 桌布模式（wallpaperDisplay、wallpaperFrame）：視窗鋪滿選定的螢幕，小島的取景另外算。
 */
import { screen, type BrowserWindow, type Display, type Rectangle } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { IslandFrame } from '../shared/ranch-protocol'
import { APP_DATA_DIR } from './species'

/** 設計尺寸（點）：原本 860×420，2026-11-11「場地再大一點」放大 1.4 倍；寬高比約 2:1，剛好放得下等角的菱形 */
export const RANCH_SIZE = { width: 1204, height: 588 }
const MAX_SCREEN_RATIO = 0.95
const MARGIN_RIGHT = 24
const PLACE_FILE = path.join(APP_DATA_DIR, 'window.json')

/** 視窗下緣中點的螢幕座標 */
interface Anchor {
  x: number
  y: number
}

function fitSize(display: Display): { width: number; height: number } {
  const wa = display.workArea
  const s = Math.min(1, (wa.width * MAX_SCREEN_RATIO) / RANCH_SIZE.width, (wa.height * MAX_SCREEN_RATIO) / RANCH_SIZE.height)
  return { width: Math.round(RANCH_SIZE.width * s), height: Math.round(RANCH_SIZE.height * s) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** 以下緣中點為準，在指定螢幕上算出視窗位置（整個留在工作區內） */
function boundsAt(anchor: Anchor, display: Display): Rectangle {
  const { width, height } = fitSize(display)
  const wa = display.workArea
  return {
    width,
    height,
    x: Math.round(clamp(anchor.x - width / 2, wa.x, wa.x + wa.width - width)),
    y: Math.round(clamp(anchor.y - height, wa.y, wa.y + wa.height - height)),
  }
}

function contains(rect: Rectangle, p: Anchor): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.width && p.y > rect.y && p.y <= rect.y + rect.height
}

function readAnchor(): Anchor | null {
  try {
    const data: unknown = JSON.parse(readFileSync(PLACE_FILE, 'utf8'))
    const r = data as Record<string, unknown>
    return typeof r?.x === 'number' && typeof r?.y === 'number' ? { x: r.x, y: r.y } : null
  } catch {
    return null
  }
}

/** 開 App 時的位置：上次的地方（螢幕還在的話），不然主螢幕右下角 */
export function initialBounds(): Rectangle {
  const saved = readAnchor()
  const display = saved && screen.getAllDisplays().find((d) => contains(d.bounds, saved))
  if (saved && display) return boundsAt(saved, display)
  const primary = screen.getPrimaryDisplay()
  const { width, height } = fitSize(primary)
  const wa = primary.workArea
  return { width, height, x: wa.x + wa.width - width - MARGIN_RIGHT, y: wa.y + wa.height - height }
}

function anchorOf(win: BrowserWindow): Anchor {
  const b = win.getBounds()
  return { x: b.x + b.width / 2, y: b.y + b.height }
}

/** 依視窗現在所在的螢幕重新調整大小與位置，並記下來（拖曳放開、螢幕變動時呼叫） */
export function refit(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const anchor = anchorOf(win)
  const display = screen.getDisplayMatching(win.getBounds())
  const next = boundsAt(anchor, display)
  const cur = win.getBounds()
  if (next.x !== cur.x || next.y !== cur.y || next.width !== cur.width || next.height !== cur.height) win.setBounds(next)
  void saveAnchor(anchorOf(win))
}

async function saveAnchor(anchor: Anchor): Promise<void> {
  try {
    await mkdir(APP_DATA_DIR, { recursive: true })
    await writeFile(PLACE_FILE, JSON.stringify({ x: Math.round(anchor.x), y: Math.round(anchor.y) }))
  } catch (err) {
    console.error('[ranch] 視窗位置存檔失敗', err)
  }
}

/** 螢幕插拔、解析度改變（稍等一下讓系統把新的螢幕資訊算好）；要做什麼由呼叫的人依模式決定 */
export function watchDisplays(onChange: () => void): void {
  const later = () => setTimeout(onChange, 300)
  screen.on('display-added', later)
  screen.on('display-removed', later)
  screen.on('display-metrics-changed', later)
}

// ── 桌布模式 ─────────────────────────────────────────

/** 置頂模式的取景：小島撐滿視窗（視窗本身已經是牧場的大小） */
export const FLOAT_FRAME: IslandFrame = { width: 0.96, bottom: 0.985, top: 0.3 }

/** 桌布要放的螢幕：選的那個不在了（外接螢幕拔掉）就用主螢幕；選擇照樣記著，接回來會搬回去 */
export function wallpaperDisplay(chosenId: number | null): Display {
  return screen.getAllDisplays().find((d) => d.id === chosenId) ?? screen.getPrimaryDisplay()
}

/**
 * 桌布模式的取景：視窗鋪滿整個螢幕（含選單列、Dock 底下），小島放在中間偏下，
 * 寬度約螢幕的 WALLPAPER_WIDTH、底部離 Dock 上緣留一點空，上方留選單列＋泡泡的空間。
 * 2026-11-11 牧場往左右加寬時 0.82 → 0.94，寶可夢在畫面上的大小才不會跟著變小（現在的等角菱形沿用這個值）。
 */
const WALLPAPER_WIDTH = 0.94
export function wallpaperFrame(display: Display): IslandFrame {
  const { bounds, workArea } = display
  const dockInset = (bounds.y + bounds.height - (workArea.y + workArea.height)) / bounds.height
  const menuInset = (workArea.y - bounds.y) / bounds.height
  return { width: WALLPAPER_WIDTH, bottom: 1 - 2 * (dockInset + 0.04), top: menuInset + 0.28 }
}

/** 選單上的螢幕名稱：系統給的名字＋解析度（點） */
export function displayLabel(display: Display, index: number): string {
  const name = display.label || `螢幕 ${index + 1}`
  const primary = display.id === screen.getPrimaryDisplay().id ? '・主螢幕' : ''
  return `${name}（${display.size.width}×${display.size.height}${primary}）`
}
