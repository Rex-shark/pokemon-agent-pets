/**
 * 介紹頁：一座活的小牧場＋泡泡圖例。
 *
 * 全部直接用牧場本體的程式（唯讀引用 src/）：RanchScene（場景）、PetActor（寶可夢）、PetOverlay（泡泡、名牌、Zzz）、
 * FightManager（打架）、playCue（音效）。這裡只負責假裝是 hook 事件，照劇本或按鈕去改每隻的狀態。
 */
import '../src/style.css'
import './showcase.css'
import './intro.css'

import * as THREE from 'three'

import { layoutBubbles, PetOverlay, type BubbleContent, type BubbleTone } from '../src/bubbles'
import { FightManager } from '../src/fights'
import { PetActor } from '../src/pet-actor'
import { RanchScene } from '../src/ranch-scene'
import { playCue } from '../src/sounds'
import { isRanchMapId, type AgentMode, type RanchCue } from '../shared/ranch-protocol'
import { fetchSpecies, toSpeciesInfo, type ShowcaseSpecies } from './api'

/** 牧場本體的「做完了！」亮 6 秒（src/main.ts 的 DONE_FLASH_MS） */
const DONE_FLASH_MS = 6000
const FIGHT_CHANCE = 0.35
const DEMO_TITLES = ['agent-pets', '部落格改版', '修登入 bug']
const DEFAULT_IDS = ['025', '004', '133']

type DemoEvent = 'busy' | 'waiting' | 'error' | 'compacting' | 'done' | 'idle' | 'sleep' | 'wake' | 'poke'

interface Step {
  event: DemoEvent
  text?: string
  ms: number
}

/** 自動播放的劇本：一輪工作會遇到的事。每隻從不同的地方開始 */
const SCRIPT: Step[] = [
  { event: 'busy', text: '翻檔案：src/main.ts', ms: 3500 },
  { event: 'busy', text: '跑指令：執行型別檢查', ms: 3500 },
  { event: 'waiting', text: '需要你確認：跑指令 npm test', ms: 5000 },
  { event: 'busy', text: '寫程式：pet-actor.ts', ms: 3500 },
  { event: 'error', text: '跑指令失敗了：npm test', ms: 4000 },
  { event: 'busy', text: '思考中…', ms: 2500 },
  { event: 'compacting', text: '整理記憶中…', ms: 3500 },
  { event: 'done', ms: DONE_FLASH_MS },
  { event: 'idle', ms: 4000 },
  { event: 'sleep', ms: 8000 },
  { event: 'wake', ms: 3000 },
]
const SCRIPT_OFFSETS = [0, 4, 7]

/** 按鈕送的事件用的說明文字 */
const MANUAL_TEXT: Partial<Record<DemoEvent, string>> = {
  busy: '跑指令：執行型別檢查',
  waiting: '需要你確認：跑指令 npm test',
  error: '跑指令失敗了：npm test',
  compacting: '整理記憶中…',
}

// ── 牧場 ─────────────────────────────────────────────

/** 牧場本體的 RanchScene 用整個視窗的大小；這裡改成用畫布自己的大小，才能放進網頁裡的一格 */
class DemoRanch extends RanchScene {
  override resize(): void {
    const canvas = this.renderer.domElement
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    this.renderer.setSize(w, h, false)
    this.frameIsland(w, h)
  }
}

interface DemoPet {
  species: ShowcaseSpecies
  title: string
  actor: PetActor
  overlay: PetOverlay
  mode: AgentMode
  label: string | null
  doneUntil: number
  asleep: boolean
  step: number
  nextAt: number
}

const stage = document.querySelector<HTMLDivElement>('#demo-stage')!
const canvas = document.querySelector<HTMLCanvasElement>('#demo-canvas')!
const overlayRoot = document.querySelector<HTMLDivElement>('#demo-overlay')!
const status = document.querySelector<HTMLParagraphElement>('#demo-status')!
const petChips = document.querySelector<HTMLDivElement>('#demo-pets')!
const eventButtons = [...document.querySelectorAll<HTMLButtonElement>('#demo-events [data-event]')]
const autoButton = document.querySelector<HTMLButtonElement>('#demo-auto')!
const soundButton = document.querySelector<HTMLButtonElement>('#demo-sound')!
const fightButton = document.querySelector<HTMLButtonElement>('#demo-fight')!
const shuffleButton = document.querySelector<HTMLButtonElement>('#demo-shuffle')!

const ranch = new DemoRanch(canvas)
// 網址加 ?map=sakura（預設的左側海以外的地圖 id，見 shared/ranch-protocol.ts）就換那張地圖：設計、調整地圖時用
const mapParam = new URLSearchParams(location.search).get('map')
if (isRanchMapId(mapParam)) ranch.setMap(mapParam)
new ResizeObserver(() => ranch.resize()).observe(stage)

let pets: DemoPet[] = []
let selected = 0
let auto = true
let soundOn = false
let fights = new FightManager(FIGHT_CHANCE)
let allSpecies: ShowcaseSpecies[] = []

function setStatus(text: string): void {
  status.textContent = text
  status.hidden = text === ''
}

function cue(kind: RanchCue): void {
  if (soundOn) playCue(kind)
}

function bubbleFor(pet: DemoPet): BubbleContent | null {
  if (pet.mode !== 'idle' && pet.label) return { tone: pet.mode, title: pet.title, text: pet.label }
  if (performance.now() < pet.doneUntil) return { tone: 'done', title: pet.title, text: '做完了！' }
  return null
}

/** 跟 src/main.ts 的 refreshPet 一樣：泡泡、等你時面向鏡頭、睡覺 */
function refresh(pet: DemoPet): void {
  pet.overlay.setBubble(bubbleFor(pet))
  pet.actor.setWaiting(pet.mode === 'waiting')
  pet.actor.setAsleep(pet.asleep && pet.actor.canSleep && pet.mode !== 'waiting')
  pet.overlay.setAsleep(pet.actor.isAsleep)
}

/** 假裝收到一個 hook 事件（對應 electron/ranch-state.ts 的狀態機） */
function send(pet: DemoPet, event: DemoEvent, text?: string): void {
  // 有 hook 就是有動靜：除了「太久沒動靜」和摸一下，其他都會叫醒
  if (event !== 'sleep' && event !== 'poke') pet.asleep = false
  switch (event) {
    case 'busy':
    case 'compacting':
      pet.mode = event
      pet.label = text ?? MANUAL_TEXT[event]!
      break
    case 'waiting':
      if (pet.mode !== 'waiting') cue('waiting')
      pet.mode = 'waiting'
      pet.label = text ?? MANUAL_TEXT.waiting!
      break
    case 'error':
      pet.mode = 'error'
      pet.label = text ?? MANUAL_TEXT.error!
      cue('error')
      pet.actor.react('error')
      break
    case 'done':
      pet.mode = 'idle'
      pet.label = null
      pet.doneUntil = performance.now() + DONE_FLASH_MS
      cue('done')
      pet.actor.react('done')
      break
    case 'idle':
    case 'wake':
      pet.mode = 'idle'
      pet.label = null
      break
    case 'sleep':
      pet.mode = 'idle'
      pet.label = null
      pet.doneUntil = 0
      pet.asleep = true
      break
    case 'poke':
      pet.actor.react('poke')
      pet.overlay.showTag(3000)
      break
  }
  refresh(pet)
}

function renderPetChips(): void {
  petChips.replaceChildren(
    ...pets.map((pet, i) => {
      const b = document.createElement('button')
      b.className = 'chip pet-chip'
      b.setAttribute('aria-pressed', String(i === selected))
      const img = document.createElement('img')
      img.src = pet.species.iconUrl
      img.alt = ''
      img.onerror = () => img.remove()
      b.append(img, `${pet.species.name}`)
      b.title = `#${pet.species.id} ${pet.species.name} · ${pet.title}`
      b.addEventListener('click', () => {
        selected = i
        renderPetChips()
        pet.overlay.showTag(2000)
      })
      return b
    }),
  )
  const pet = pets[selected]
  const sleepButton = eventButtons.find((b) => b.dataset.event === 'sleep')!
  const canSleep = pet?.actor.loaded ? pet.actor.canSleep : true
  sleepButton.disabled = !canSleep
  sleepButton.title = canSleep ? '' : `${pet?.species.name ?? ''}沒有睡覺動作（151 隻裡有 37 隻沒有），不會睡著`
}

function setAuto(next: boolean): void {
  auto = next
  autoButton.setAttribute('aria-pressed', String(auto))
  if (auto) {
    const now = performance.now()
    for (const pet of pets) pet.nextAt = now
  }
}

function clearPets(): void {
  for (const pet of pets) {
    pet.actor.dispose()
    pet.overlay.dispose()
  }
  pets = []
}

function pickSpecies(random: boolean): ShowcaseSpecies[] {
  if (!random) {
    const preferred = DEFAULT_IDS.map((id) => allSpecies.find((s) => s.id === id)).filter((s) => s !== undefined)
    if (preferred.length === DEFAULT_IDS.length) return preferred
  }
  const pool = [...allSpecies]
  const out: ShowcaseSpecies[] = []
  while (out.length < 3 && pool.length > 0) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return out
}

async function populate(random: boolean): Promise<void> {
  clearPets()
  const chosen = pickSpecies(random)
  if (chosen.length === 0) return
  setStatus('寶可夢進場中…')
  const now = performance.now()
  pets = chosen.map((species, i) => {
    const actor = new PetActor(`demo-${i}`, toSpeciesInfo(species), ranch)
    const overlay = new PetOverlay(overlayRoot)
    const title = DEMO_TITLES[i % DEMO_TITLES.length]
    overlay.setTag(`${species.name} · ${title}`)
    ranch.scene.add(actor.root)
    return {
      species,
      title,
      actor,
      overlay,
      mode: 'idle' as AgentMode,
      label: null,
      doneUntil: 0,
      asleep: false,
      step: SCRIPT_OFFSETS[i % SCRIPT_OFFSETS.length],
      nextAt: now + 1200 + i * 400,
    }
  })
  selected = Math.min(selected, pets.length - 1)
  renderPetChips()
  const batch = pets
  const results = await Promise.allSettled(batch.map((p) => p.actor.load()))
  if (batch !== pets) return
  const failed = results.filter((r) => r.status === 'rejected').length
  setStatus(failed > 0 ? `有 ${failed} 隻的模型載入失敗` : '')
  for (const pet of pets) {
    if (pet.actor.loaded) pet.actor.react('arrive')
    refresh(pet)
  }
  renderPetChips()
}

// ── 按鈕與滑鼠 ───────────────────────────────────────

for (const button of eventButtons) {
  button.addEventListener('click', () => {
    const pet = pets[selected]
    if (!pet) return
    setAuto(false)
    send(pet, button.dataset.event as DemoEvent)
  })
}
autoButton.addEventListener('click', () => setAuto(!auto))
soundButton.addEventListener('click', () => {
  soundOn = !soundOn
  soundButton.setAttribute('aria-pressed', String(soundOn))
})
fightButton.addEventListener('click', () => {
  const always = fightButton.getAttribute('aria-pressed') !== 'true'
  fightButton.setAttribute('aria-pressed', String(always))
  fights = new FightManager(always ? 1 : FIGHT_CHANCE)
})
shuffleButton.addEventListener('click', () => void populate(true))

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function pick(e: MouseEvent): DemoPet | null {
  const rect = canvas.getBoundingClientRect()
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, ranch.camera)
  const loaded = pets.filter((p) => p.actor.loaded)
  const hit = raycaster.intersectObjects(
    loaded.map((p) => p.actor.hitBox),
    false,
  )[0]
  return hit ? (loaded.find((p) => p.actor.hitBox === hit.object) ?? null) : null
}

canvas.addEventListener('mousemove', (e) => {
  const pet = pick(e)
  if (pet) pet.overlay.showTag(1200)
  canvas.style.cursor = pet ? 'pointer' : 'default'
})
canvas.addEventListener('click', (e) => {
  const pet = pick(e)
  if (!pet) return
  selected = pets.indexOf(pet)
  renderPetChips()
  send(pet, 'poke')
})

// ── 動畫迴圈 ─────────────────────────────────────────

let visible = true
new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(stage)

const timer = new THREE.Timer()
timer.connect(document)
const head = new THREE.Vector3()
const ndc = new THREE.Vector3()
let refreshCheck = 0

function frame(time: number): void {
  requestAnimationFrame(frame)
  timer.update(time)
  const dt = Math.min(timer.getDelta(), 0.1)
  if (!visible) return
  const now = performance.now()

  if (auto) {
    for (const pet of pets) {
      if (!pet.actor.loaded || now < pet.nextAt) continue
      let step = SCRIPT[pet.step % SCRIPT.length]
      // 沒有睡覺動作的就跳過睡覺那段
      if (step.event === 'sleep' && !pet.actor.canSleep) {
        pet.step++
        step = SCRIPT[pet.step % SCRIPT.length]
      }
      send(pet, step.event, step.text)
      pet.nextAt = now + step.ms
      pet.step++
    }
  }

  const actors = pets.map((p) => p.actor)
  for (const actor of actors) actor.update(dt, actors)
  fights.update(actors, now)

  // 「做完了！」時間到要收起來
  refreshCheck -= dt
  if (refreshCheck <= 0) {
    refreshCheck = 0.5
    for (const pet of pets) pet.overlay.setBubble(bubbleFor(pet))
  }

  const w = canvas.clientWidth
  const h = canvas.clientHeight
  for (const pet of pets) {
    const { root, height } = pet.actor
    head.copy(root.position)
    head.y += height + pet.actor.hover + 0.12
    // place() 會依名牌的時間切換顯示；它的座標用整個視窗算，下面改成用畫布的大小重算
    pet.overlay.place(head, root.position, ranch.camera)
    ndc.copy(head).project(ranch.camera)
    pet.overlay.screenX = (ndc.x * 0.5 + 0.5) * w
    pet.overlay.screenY = (-ndc.y * 0.5 + 0.5) * h
    ndc.copy(root.position).project(ranch.camera)
    pet.overlay.depth = (-ndc.y * 0.5 + 0.5) * h
  }
  layoutBubbles(pets.map((p) => p.overlay))
  ranch.render()
}
requestAnimationFrame(frame)

// ── 泡泡圖例 ─────────────────────────────────────────

interface LegendItem {
  tone: BubbleTone | 'sleep'
  name: string
  text: string
  desc: string
  cue: RanchCue | null
  icon: string
}

const LEGEND: LegendItem[] = [
  { tone: 'busy', name: '白色・在做事', text: '跑指令：執行型別檢查', desc: '用工具、思考的時候。「動詞：說明」，沒有音效，不打擾你。', cue: null, icon: '025' },
  {
    tone: 'waiting',
    name: '黃色・等你確認',
    text: '需要你確認：跑指令 npm test',
    desc: '要權限、問你問題、計畫等你批准。泡泡會跳，寵物停下來面向你，叮咚兩聲。',
    cue: 'waiting',
    icon: '001',
  },
  { tone: 'error', name: '紅色・出錯', text: '跑指令失敗了：npm test', desc: '工具失敗。寵物播一次攻擊動作，往下滑的兩聲低音。', cue: 'error', icon: '004' },
  { tone: 'compacting', name: '紫色・整理記憶', text: '整理記憶中…', desc: '對話太長，Claude 在壓縮記憶。沒有音效。', cue: null, icon: '007' },
  { tone: 'done', name: '綠色・做完了', text: '做完了！', desc: '做完一輪，亮 6 秒。寵物開心一下，往上的三個音。', cue: 'done', icon: '133' },
  { tone: 'sleep', name: 'Zzz・睡著了', text: '', desc: '5 分鐘沒有 hook，有睡覺動作的就躺下；下一個 hook 一來就醒。', cue: null, icon: '143' },
]

function buildLegend(): void {
  const root = document.querySelector<HTMLDivElement>('#legend')!
  for (const item of LEGEND) {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'legend-card card'
    card.setAttribute('aria-label', `${item.name}：${item.desc}${item.cue ? '（點一下播音效）' : ''}`)

    const legendStage = document.createElement('div')
    legendStage.className = 'legend-stage'
    const icon = document.createElement('img')
    icon.className = 'legend-icon'
    icon.src = `/models/${item.icon}/icon.png`
    icon.alt = ''
    icon.onerror = () => icon.classList.add('missing')
    legendStage.append(icon)
    const overlay = new PetOverlay(legendStage)
    overlay.el.classList.add('legend-anchor')
    const content: BubbleContent | null = item.tone === 'sleep' ? null : { tone: item.tone, title: 'agent-pets', text: item.text }
    overlay.setBubble(content)
    if (item.tone === 'sleep') overlay.setAsleep(true)

    const name = document.createElement('h3')
    name.textContent = item.name
    const desc = document.createElement('p')
    desc.textContent = item.desc
    const sound = document.createElement('span')
    sound.className = 'legend-sound'
    sound.textContent = item.cue ? '▶ 點一下聽音效' : '沒有音效'
    card.append(legendStage, name, desc, sound)

    card.addEventListener('click', () => {
      if (content) {
        overlay.setBubble(null)
        requestAnimationFrame(() => overlay.setBubble(content))
      }
      if (item.cue) playCue(item.cue)
    })
    root.append(card)
  }
}

// ── 開始 ─────────────────────────────────────────────

buildLegend()
renderPetChips()
fetchSpecies()
  .then((list) => {
    allSpecies = list.species
    if (allSpecies.length === 0) {
      setStatus('找不到寶可夢模型：照 README 的「準備模型」把模型放進 agent-pets/models/，再重開展示網站')
      shuffleButton.disabled = true
      return
    }
    return populate(false)
  })
  .catch((err) => {
    console.error(err)
    setStatus('讀不到品種清單：請用 npm run showcase 開這個網站')
  })
