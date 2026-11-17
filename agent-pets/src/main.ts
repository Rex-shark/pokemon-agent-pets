/**
 * renderer 入口：牧場場景＋每個 agent 一隻寶可夢＋頭上的泡泡。
 *
 * 資料：主行程每個 hook 事件送一次完整快照（RanchUpdate）。這裡依快照新增／移除寵物、更新泡泡，
 * 快照帶的提醒（cue）播音效、讓寵物做一次動作。
 *
 * 睡覺：每秒檢查一次，太久（config.sleepAfterMs）沒有這個 agent 的 hook、而且不是在等你，
 * 模型有 sleep 動作的就睡著；下一個 hook 一來就醒。
 *
 * 滑鼠（只有置頂模式）：視窗平常整片穿透。游標在草地、寵物或泡泡上時才接滑鼠：點寵物＝摸一下（開心＋名牌），
 * 按住草地拖曳＝搬動整個牧場。桌布模式的視窗在桌面背景層，收不到滑鼠，主行程也不理會穿透與拖曳的訊息。
 */
import './style.css'

import * as THREE from 'three'

import type { PetView, RanchBridge, RanchConfig, RanchUpdate, SpeciesInfo } from '../shared/ranch-protocol'
import { layoutBubbles, PetOverlay, type BubbleContent } from './bubbles'
import { FightManager } from './fights'
import { NpcTroupe } from './npcs'
import { PetActor } from './pet-actor'
import { RanchScene } from './ranch-scene'
import { playCue } from './sounds'

declare global {
  interface Window {
    ranchBridge?: RanchBridge
  }
}

/** 「做完了！」綠色泡泡亮多久 */
const DONE_FLASH_MS = 6000
/** 剛認養的寵物出場時開心一下（快照裡 adoptedAt 在這個時間內才算剛認養） */
const ARRIVE_WINDOW_MS = 15_000

interface Pet {
  actor: PetActor
  overlay: PetOverlay
  view: PetView
  doneUntil: number
}

const canvas = document.querySelector<HTMLCanvasElement>('#ranch')!
const overlayRoot = document.querySelector<HTMLDivElement>('#overlay')!
const notice = document.createElement('div')
notice.className = 'notice'
overlayRoot.append(notice)

const ranch = new RanchScene(canvas)
const pets = new Map<string, Pet>()
/** 不屬於任何 session 的 NPC（月面基地罩外的皮皮與皮可西）；其他地圖是空的 */
const npcs = new NpcTroupe(ranch)
let config: RanchConfig = {
  mode: 'float',
  frame: { width: 0.96, bottom: 0.985, top: 0.3 },
  map: 'lake-left',
  species: [],
  modelsDir: '',
  sleepAfterMs: 5 * 60_000,
  fightChance: 0,
}
let fights = new FightManager(0)
let speciesById = new Map<string, SpeciesInfo>()

function petTitle(view: PetView): string | null {
  const title = view.title ?? view.project
  return view.provider === 'codex' ? `Codex${title ? ` · ${title}` : ''}` : title
}

function addPet(view: PetView): void {
  const species = speciesById.get(view.speciesId)
  if (!species) return
  const actor = new PetActor(view.sessionId, species, ranch)
  const overlay = new PetOverlay(overlayRoot)
  const pet: Pet = { actor, overlay, view, doneUntil: 0 }
  pets.set(view.sessionId, pet)
  ranch.scene.add(actor.root)
  actor
    .load()
    .then(() => {
      if (Date.now() - view.adoptedAt < ARRIVE_WINDOW_MS) actor.react('arrive')
      refreshPet(pet)
    })
    .catch((err) => console.error(`[ranch] #${species.id} ${species.name} 模型載入失敗`, err))
}

function removePet(sessionId: string): void {
  const pet = pets.get(sessionId)
  if (!pet) return
  pet.actor.dispose()
  pet.overlay.dispose()
  pets.delete(sessionId)
}

function bubbleFor(pet: Pet): BubbleContent | null {
  const { view } = pet
  const title = petTitle(view)
  if (view.mode !== 'idle' && view.label) return { tone: view.mode, title, text: view.label }
  if (performance.now() < pet.doneUntil) return { tone: 'done', title, text: '做完了！' }
  return null
}

function refreshPet(pet: Pet): void {
  const { view, actor, overlay } = pet
  overlay.setTag(`${actor.species.name}${petTitle(view) ? ` · ${petTitle(view)}` : ''}${view.active ? '' : '（下線）'}`)
  overlay.setBubble(bubbleFor(pet))
  actor.setWaiting(view.mode === 'waiting')
  const asleep = actor.canSleep && view.mode !== 'waiting' && Date.now() - view.lastEventAt > config.sleepAfterMs
  actor.setAsleep(asleep)
  overlay.setAsleep(actor.isAsleep)
}

function updateNotice(): void {
  if (config.species.length === 0) {
    notice.textContent = `還沒有寶可夢模型：照 README 的「準備模型」把模型放進 agent-pets/models/，再重新啟動（現在讀的是 ${config.modelsDir}）`
  } else if (pets.size === 0) {
    notice.textContent = '牧場還空空的：開一個 Claude session，就會有寶可夢來認養'
  } else {
    notice.textContent = ''
  }
  notice.hidden = notice.textContent === ''
}

function applyUpdate(update: RanchUpdate): void {
  const seen = new Set<string>()
  for (const view of update.pets) {
    seen.add(view.sessionId)
    const pet = pets.get(view.sessionId)
    if (!pet) {
      addPet(view)
      continue
    }
    pet.view = view
  }
  for (const id of [...pets.keys()]) if (!seen.has(id)) removePet(id)

  if (update.cue) {
    playCue(update.cue.kind)
    const pet = pets.get(update.cue.sessionId)
    if (pet) {
      if (update.cue.kind === 'done') {
        pet.doneUntil = performance.now() + DONE_FLASH_MS
        pet.actor.react('done')
      } else if (update.cue.kind === 'error') {
        pet.actor.react('error')
      }
    }
  }
  for (const pet of pets.values()) refreshPet(pet)
  updateNotice()
}

// ── 滑鼠 ─────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let through = true
let dragging = false

function pick(x: number, y: number): { pet: Pet | null; onRanch: boolean } {
  pointer.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, ranch.camera)
  const boxes = [...pets.values()].filter((p) => p.actor.loaded).map((p) => p.actor.hitBox)
  const hit = raycaster.intersectObjects(boxes, false)[0]
  if (hit) return { pet: pets.get(hit.object.userData.sessionId as string) ?? null, onRanch: true }
  return { pet: null, onRanch: raycaster.intersectObject(ranch.ground, false).length > 0 }
}

function setThrough(next: boolean): void {
  if (next === through) return
  through = next
  window.ranchBridge?.setMouseThrough(next)
}

window.addEventListener('mousemove', (e) => {
  if (dragging) {
    // 保險：放開滑鼠的 mouseup 沒收到（Windows 拖太快、游標跑出視窗時可能發生），看按鍵狀態自己結束拖曳
    if ((e.buttons & 1) === 0) endDrag()
    return
  }
  const overBubble = (e.target as Element | null)?.closest?.('.bubble, .tag') != null
  const { pet, onRanch } = pick(e.clientX, e.clientY)
  if (pet) pet.overlay.showTag(1200)
  setThrough(!(overBubble || onRanch))
  canvas.style.cursor = pet ? 'pointer' : onRanch ? 'grab' : 'default'
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  const { pet, onRanch } = pick(e.clientX, e.clientY)
  if (pet) {
    pet.actor.react('poke')
    pet.overlay.showTag(3000)
    return
  }
  if (onRanch) {
    dragging = true
    canvas.style.cursor = 'grabbing'
    window.ranchBridge?.drag('start')
  }
})

function endDrag(): void {
  if (!dragging) return
  dragging = false
  canvas.style.cursor = 'grab'
  window.ranchBridge?.drag('end')
}

window.addEventListener('mouseup', endDrag)
// 拖到一半視窗失去焦點（例如按了 Alt+Tab）：不要讓視窗繼續黏著游標
window.addEventListener('blur', endDrag)

// 游標離開視窗：一定要回到穿透，不然視窗會卡著擋住後面的東西
document.addEventListener('mouseleave', () => {
  if (!dragging) setThrough(true)
})

window.addEventListener('resize', () => ranch.resize())
/** 縮放比例變了（視窗搬到另一個螢幕）但大小沒變時不會有 resize 事件：用 media query 盯著 devicePixelRatio */
function watchPixelRatio(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      ranch.resize()
      watchPixelRatio()
    },
    { once: true },
  )
}
watchPixelRatio()

// ── 動畫迴圈 ─────────────────────────────────────────

const timer = new THREE.Timer()
timer.connect(document)
let sleepCheck = 0
const head = new THREE.Vector3()

function frame(time: number): void {
  timer.update(time)
  const dt = Math.min(timer.getDelta(), 0.1)
  const actors = [...pets.values()].map((p) => p.actor)
  for (const actor of actors) actor.update(dt, actors)
  npcs.update(dt)
  fights.update(actors, performance.now())

  sleepCheck -= dt
  if (sleepCheck <= 0) {
    sleepCheck = 1
    for (const pet of pets.values()) refreshPet(pet)
  }

  for (const pet of pets.values()) {
    const { root, height } = pet.actor
    head.copy(root.position)
    head.y += height + pet.actor.hover + 0.12
    pet.overlay.place(head, root.position, ranch.camera)
    pet.overlay.setMood(pet.actor.mood)
  }
  layoutBubbles([...pets.values()].map((p) => p.overlay))
  ranch.render()
  requestAnimationFrame(frame)
}

async function start(): Promise<void> {
  const bridge = window.ranchBridge
  if (bridge) {
    // 先掛監聽再拿設定：主行程在頁面載完就補發快照，可能比 getConfig 先到；先存著，拿到設定再套用
    let ready = false
    let pending: RanchUpdate | null = null
    bridge.onUpdate((update) => {
      if (ready) applyUpdate(update)
      else pending = update
    })
    config = await bridge.getConfig()
    speciesById = new Map(config.species.map((s) => [s.id, s]))
    fights = new FightManager(config.fightChance)
    // 先換地圖再擺寵物（寵物出場時照地圖挑位置）
    ranch.setMap(config.map)
    npcs.reset(speciesById)
    ranch.setFrame(config.frame)
    // 螢幕變動（桌布模式 Dock、選單列變了）：主行程送新的取景，原地重新取景，寵物不重建、不換位置
    bridge.onFrame((frame) => ranch.setFrame(frame))
    document.body.dataset.mode = config.mode
    ready = true
    if (pending) applyUpdate(pending)
  } else {
    notice.textContent = '請用 Electron 開（npm run dev）'
  }
  bridge?.setMouseThrough(true)
  updateNotice()
  requestAnimationFrame(frame)
}

void start()
