/**
 * 寵物頭上的漫畫符號特效（2026-11-11 使用者要的）：
 * - 打架中：紅色「生氣青筋」符號、白色冒煙，各 1～3 個，圍在頭的附近、位置隨機；每場開打時重新擲一次
 * - 打輸逃跑：頭的側邊一滴汗
 *
 * 都是 inline SVG＋CSS 動畫（樣式在 style.css 的 .fx），不用圖檔。大小跟著寵物在畫面上的高度（--ps）縮放，
 * 大隻、小隻看起來比例一樣。位置以頭頂為原點，用寵物畫面高度的比例表示。
 */

export type PetMood = 'fight' | 'flee' | null

/** 生氣青筋：四個朝中心彎的弧（漫畫裡那個紅色十字血管） */
const ANGER_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <g fill="none" stroke="#e8322f" stroke-width="13" stroke-linecap="round">
    <path d="M39 9 Q41 39 9 39"/><path d="M61 9 Q59 39 91 39"/>
    <path d="M39 91 Q41 61 9 61"/><path d="M61 91 Q59 61 91 61"/>
  </g>
</svg>`

/** 冒煙：三顆疊在一起的白色圓，淡灰邊 */
const SMOKE_SVG = `<svg viewBox="0 0 120 90" aria-hidden="true">
  <g fill="#ffffff" stroke="#8f99a6" stroke-width="7">
    <circle cx="38" cy="55" r="28"/><circle cx="80" cy="52" r="30"/><circle cx="60" cy="30" r="26"/>
  </g>
  <g fill="#ffffff"><circle cx="38" cy="55" r="25"/><circle cx="80" cy="52" r="27"/><circle cx="60" cy="30" r="23"/></g>
</svg>`

/** 汗滴：淡藍水滴＋白色反光 */
const SWEAT_SVG = `<svg viewBox="0 0 60 84" aria-hidden="true">
  <path d="M30 4 C30 4 54 40 54 56 A24 24 0 0 1 6 56 C6 40 30 4 30 4 Z" fill="#9fdcff" stroke="#3d8fd8" stroke-width="5" stroke-linejoin="round"/>
  <ellipse cx="21" cy="56" rx="6" ry="10" fill="#ffffff" opacity="0.85" transform="rotate(-20 21 56)"/>
</svg>`

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * 放一個符號。x、y 是相對頭頂的位置（寵物畫面高度的比例，y 往下為正）；size 也是比例。
 * 動畫延遲隨機，同一場的幾個符號不會一起動。
 */
function symbol(kind: 'anger' | 'smoke' | 'sweat', x: number, y: number, size: number): HTMLElement {
  const el = document.createElement('div')
  el.className = `fx-item fx-${kind}`
  el.style.setProperty('--x', x.toFixed(3))
  el.style.setProperty('--y', y.toFixed(3))
  el.style.setProperty('--size', size.toFixed(3))
  el.style.animationDelay = `${(-Math.random() * 1.2).toFixed(2)}s`
  el.innerHTML = kind === 'anger' ? ANGER_SVG : kind === 'smoke' ? SMOKE_SVG : SWEAT_SVG
  return el
}

/** 依心情產生一組符號（打架每次開打重新擲：數量、位置都隨機） */
export function buildEffects(mood: PetMood): HTMLElement[] {
  if (mood === 'fight') {
    const items: HTMLElement[] = []
    // 青筋在頭的上半部左右兩側；冒煙在頭頂上方飄
    const side = Math.random() < 0.5 ? -1 : 1
    for (let i = 0, n = randInt(1, 3); i < n; i++) {
      const s = i % 2 === 0 ? side : -side
      items.push(symbol('anger', s * rand(0.18, 0.42), rand(-0.12, 0.22), rand(0.2, 0.28)))
    }
    for (let i = 0, n = randInt(1, 3); i < n; i++) {
      items.push(symbol('smoke', rand(-0.42, 0.42), rand(-0.3, -0.05), rand(0.32, 0.44)))
    }
    return items
  }
  if (mood === 'flee') {
    // 汗滴在頭的側邊、比頭頂低一點
    const s = Math.random() < 0.5 ? -1 : 1
    return [symbol('sweat', s * rand(0.22, 0.34), rand(0.08, 0.2), 0.2)]
  }
  return []
}
