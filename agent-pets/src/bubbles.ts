/**
 * 寵物頭上的 HTML 疊層：雲朵聊天泡泡、名牌、睡覺的 Zzz、打架與逃跑的漫畫符號（effects.ts）。每格把頭頂的 3D 位置投影到畫面上。
 *
 * 泡泡顏色（跟 live2d 桌寵一致）：
 * - busy 白色（在做事）
 * - waiting 黃色＋輕輕跳動（等你確認）
 * - error 紅色（工具失敗）
 * - compacting 淡紫（整理記憶）
 * - done 綠色「做完了！」（做完一輪後亮幾秒）
 *
 * 好幾個泡泡疊在一起時，後面那隻的泡泡往上推，不互相蓋住。
 */
import * as THREE from 'three'

import type { AgentMode } from '../shared/ranch-protocol'
import { buildEffects, type PetMood } from './effects'

export type BubbleTone = Exclude<AgentMode, 'idle'> | 'done'

export interface BubbleContent {
  tone: BubbleTone
  title: string | null
  text: string
}

const TITLE_MAX = 14

function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

export class PetOverlay {
  readonly el = document.createElement('div')
  private readonly bubble = document.createElement('div')
  private readonly bubbleTitle = document.createElement('div')
  private readonly bubbleText = document.createElement('div')
  private readonly tag = document.createElement('div')
  private readonly zzz = document.createElement('div')
  private readonly fx = document.createElement('div')
  private mood: PetMood = null
  private tagUntil = 0
  private key = ''
  /** 這一格泡泡在畫面上的位置（排開重疊用） */
  screenX = 0
  screenY = 0
  /** 腳在畫面上的 y：越大越靠前 */
  depth = 0
  bubbleVisible = false

  constructor(parent: HTMLElement) {
    this.el.className = 'pet-ui'
    this.bubble.className = 'bubble'
    this.bubbleTitle.className = 'bubble-title'
    this.bubbleText.className = 'bubble-text'
    // 上緣原本有三個雲朵小丘（.puffs），2026-11-13 使用者「文字泡泡上面的 3 個半圓形移除」→ 拿掉，只留圓角框和尾巴
    const tail = document.createElement('div')
    tail.className = 'tail'
    tail.innerHTML = '<i></i><i></i>'
    this.bubble.append(this.bubbleTitle, this.bubbleText, tail)
    this.tag.className = 'tag'
    this.zzz.className = 'zzz'
    this.zzz.innerHTML = '<span>Z</span><span>z</span><span>z</span>'
    this.fx.className = 'fx'
    this.el.append(this.fx, this.bubble, this.zzz, this.tag)
    parent.append(this.el)
  }

  setBubble(content: BubbleContent | null): void {
    const key = content ? `${content.tone}|${content.title}|${content.text}` : ''
    if (key === this.key) return
    this.key = key
    this.bubbleVisible = content !== null
    this.bubble.classList.toggle('show', content !== null)
    if (!content) return
    this.bubble.dataset.tone = content.tone
    this.bubbleTitle.textContent = content.title ? truncate(content.title, TITLE_MAX) : ''
    this.bubbleTitle.hidden = !content.title
    this.bubbleText.textContent = content.text
    // 重播出現動畫
    this.bubble.classList.remove('pop')
    void this.bubble.offsetWidth
    this.bubble.classList.add('pop')
  }

  setTag(text: string): void {
    this.tag.textContent = text
  }

  /** 滑鼠移過或點到時顯示名牌幾秒 */
  showTag(ms = 2500): void {
    this.tagUntil = performance.now() + ms
  }

  /** 打架（生氣＋冒煙）、逃跑（汗滴）的符號；心情變了才重新產生（每場開打位置、數量都重新擲） */
  setMood(mood: PetMood): void {
    if (mood === this.mood) return
    this.mood = mood
    this.fx.replaceChildren(...buildEffects(mood))
  }

  setAsleep(asleep: boolean): void {
    this.zzz.classList.toggle('show', asleep)
  }

  /** 把頭頂的世界座標投影到畫面 */
  place(head: THREE.Vector3, feet: THREE.Vector3, camera: THREE.Camera): void {
    const p = head.clone().project(camera)
    const f = feet.clone().project(camera)
    this.screenX = (p.x * 0.5 + 0.5) * window.innerWidth
    this.screenY = (-p.y * 0.5 + 0.5) * window.innerHeight
    this.depth = (-f.y * 0.5 + 0.5) * window.innerHeight
    // 寵物在畫面上多高（頭頂到腳）：特效照這個縮放
    this.fx.style.setProperty('--ps', `${Math.max(this.depth - this.screenY, 24).toFixed(1)}px`)
    this.tag.classList.toggle('show', performance.now() < this.tagUntil)
  }

  /** 排開之後的最終位置 */
  commit(bubbleOffsetY: number): void {
    this.el.style.transform = `translate(${this.screenX.toFixed(1)}px, ${this.screenY.toFixed(1)}px)`
    this.bubble.style.setProperty('--lift', `${bubbleOffsetY.toFixed(1)}px`)
    this.el.style.zIndex = String(Math.round(this.depth))
  }

  bubbleSize(): { w: number; h: number } {
    return { w: this.bubble.offsetWidth, h: this.bubble.offsetHeight }
  }

  dispose(): void {
    this.el.remove()
  }
}

/** 靠前（depth 大）的泡泡不動，靠後的往上推到不重疊為止 */
export function layoutBubbles(overlays: PetOverlay[]): void {
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const ordered = [...overlays].sort((a, b) => b.depth - a.depth)
  for (const o of ordered) {
    if (!o.bubbleVisible) {
      o.commit(0)
      continue
    }
    const { w, h } = o.bubbleSize()
    // 泡泡底部在頭頂上方，水平置中
    let lift = 0
    for (let pass = 0; pass < 6; pass++) {
      const bottom = o.screenY - lift
      const box = { x: o.screenX - w / 2, y: bottom - h, w, h }
      const hit = placed.find((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)
      if (!hit) break
      lift += box.y + box.h - hit.y + 4
    }
    const bottom = o.screenY - lift
    placed.push({ x: o.screenX - w / 2, y: bottom - h, w, h })
    o.commit(lift)
  }
}
