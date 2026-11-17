/**
 * 動作圖鑑：151 隻的清單（可搜尋）＋ three.js 檢視器，按鈕切換牠有的動作，可以旋轉、縮放。
 *
 * 載模型、量大小的做法照 src/pet-actor.ts：擺出待機第一格的姿勢量外框（量之前要先 skeleton.update()，
 * 不然量到的是綁定姿勢），縮成統一高度、腳底貼地、置中。這裡不壓會飛的高度，照模型原本的動作播，
 * 另外量出每個動作離地多高（牧場裡最多只浮 0.3 個身高）。
 */
import './showcase.css'
import './dex.css'

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { ACTION_LABEL, ACTION_ORDER, fetchSpecies, type ShowcaseSpecies } from './api'

const HEIGHT = 1
/** 牧場（src/pet-actor.ts）的會飛上限 */
const RANCH_MAX_HOVER = 0.3
const FADE = 0.3

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const listEl = $<HTMLUListElement>('#dex-list')
const searchEl = $<HTMLInputElement>('#dex-q')
const countEl = $<HTMLParagraphElement>('#dex-count')
const filterButtons = [...document.querySelectorAll<HTMLButtonElement>('#dex-filter [data-filter]')]
const stage = $<HTMLDivElement>('#view-stage')
const canvas = $<HTMLCanvasElement>('#view-canvas')
const statusEl = $<HTMLParagraphElement>('#view-status')
const iconEl = $<HTMLImageElement>('#view-icon')
const noEl = $<HTMLParagraphElement>('#view-no')
const nameEl = $<HTMLHeadingElement>('#view-name')
const badgesEl = $<HTMLParagraphElement>('#view-badges')
const actionsEl = $<HTMLDivElement>('#view-actions')
const progressEl = $<HTMLSpanElement>('#view-progress')
const infoEl = $<HTMLParagraphElement>('#view-info')
const pauseButton = $<HTMLButtonElement>('#tool-pause')
const rotateButton = $<HTMLButtonElement>('#tool-rotate')
const resetButton = $<HTMLButtonElement>('#tool-reset')
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')]

let species: ShowcaseSpecies[] = []
let filter: 'all' | 'sleep' | 'nosleep' = 'all'

const hasSleep = (s: ShowcaseSpecies) => s.animations.some((a) => a.name === 'sleep')

function setStatus(text: string): void {
  statusEl.textContent = text
  statusEl.hidden = text === ''
}

// ── 3D 檢視器 ────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55
scene.add(new THREE.HemisphereLight(0xffffff, 0x8fb98a, 1.4))
const sun = new THREE.DirectionalLight(0xffffff, 1.8)
sun.position.set(2.5, 4, 3)
scene.add(sun)

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.autoRotateSpeed = 1.6
controls.minDistance = 0.6
controls.maxDistance = 12
controls.maxPolarAngle = Math.PI * 0.62

/** 草地圓台＋一圈刻度（離地高度看得出來） */
const ground = new THREE.Mesh(
  new THREE.CylinderGeometry(1.5, 1.58, 0.12, 64),
  new THREE.MeshStandardMaterial({ color: 0x8ccf6c, roughness: 0.95 }),
)
ground.position.y = -0.06
scene.add(ground)
const rim = new THREE.Mesh(
  new THREE.CylinderGeometry(1.58, 1.5, 0.2, 64, 1, true),
  new THREE.MeshStandardMaterial({ color: 0xa5764b, roughness: 1 }),
)
rim.position.y = -0.22
scene.add(rim)

function blobShadow(): THREE.Mesh {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.35)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.004
  mesh.renderOrder = -1
  return mesh
}
const shadow = blobShadow()
scene.add(shadow)

function resize(): void {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(stage)
resize()

const loader = new GLTFLoader()

interface Loaded {
  species: ShowcaseSpecies
  gltf: GLTF
  holder: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  /** 每個動作第一格的腳底離地多高（身高的比例；負的是陷進地裡） */
  lift: Map<string, number>
  current: THREE.AnimationAction | null
  currentName: string | null
  /** 縮放後的寬（取景用） */
  width: number
}

let loaded: Loaded | null = null
let loadToken = 0
let speed = 1
let paused = false

/** 擺出某個動作第一格的姿勢量外框（照 src/pet-actor.ts 的 measure） */
function measure(model: THREE.Object3D, mixer: THREE.AnimationMixer, action: THREE.AnimationAction | null): THREE.Box3 {
  mixer.stopAllAction()
  action?.reset().play()
  mixer.update(0)
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.update()
  })
  return new THREE.Box3().setFromObject(model, true)
}

function disposeLoaded(item: Loaded): void {
  item.mixer.stopAllAction()
  item.holder.removeFromParent()
  item.gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose()
      m.dispose()
    }
  })
}

function frameCamera(width: number): void {
  const span = Math.max(HEIGHT, width * 0.8)
  // 留一些空間給會飛的、會跳的動作，也看得到草地圓台
  const dist = ((span * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.7 + width * 0.5
  controls.target.set(0, HEIGHT * 0.5, 0)
  camera.position.set(dist * 0.42, HEIGHT * 0.5 + dist * 0.28, dist * 0.86)
  camera.updateProjectionMatrix()
  controls.update()
}

async function show(s: ShowcaseSpecies): Promise<void> {
  const token = ++loadToken
  renderHeader(s)
  renderActions(s, null)
  setStatus('載入模型中…')
  let gltf: GLTF
  try {
    gltf = await loader.loadAsync(s.modelUrl)
  } catch (err) {
    if (token !== loadToken) return
    console.error(err)
    setStatus(`#${s.id} ${s.name} 的模型載入失敗`)
    return
  }
  if (token !== loadToken) return

  const model = gltf.scene
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false
  })
  const mixer = new THREE.AnimationMixer(model)
  const actions = new Map<string, THREE.AnimationAction>()
  for (const clip of gltf.animations) {
    const name = clip.name.toLowerCase()
    const key = ACTION_ORDER.find((k) => name === k || name.includes(k))
    if (key && !actions.has(key)) actions.set(key, mixer.clipAction(clip))
  }

  const idle = actions.get('idle') ?? null
  const box = measure(model, mixer, idle)
  const size = box.getSize(new THREE.Vector3())
  const scale = HEIGHT / Math.max(size.y, 1e-3)
  const lift = new Map<string, number>()
  for (const [name, action] of actions) lift.set(name, (measure(model, mixer, action).min.y - box.min.y) / Math.max(size.y, 1e-3))
  mixer.stopAllAction()

  const center = box.getCenter(new THREE.Vector3())
  const holder = new THREE.Group()
  holder.scale.setScalar(scale)
  model.position.set(-center.x, -box.min.y, -center.z)
  holder.add(model)

  if (loaded) disposeLoaded(loaded)
  scene.add(holder)
  const width = Math.max(size.x, size.z) * scale
  shadow.scale.setScalar(Math.max(width * 0.95, 0.5))
  loaded = { species: s, gltf, holder, mixer, actions, lift, current: null, currentName: null, width }
  frameCamera(width)
  setStatus('')
  play('idle')
}

function play(name: string): void {
  const item = loaded
  if (!item) return
  const action = item.actions.get(name)
  if (!action) return
  if (item.current !== action) {
    action.reset()
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.enabled = true
    action.setEffectiveWeight(1)
    action.play()
    if (item.current) item.current.crossFadeTo(action, FADE, false)
    item.current = action
    item.currentName = name
  } else {
    action.reset().play()
  }
  renderActions(item.species, name)
  renderInfo(item, name)
}

function renderInfo(item: Loaded, name: string): void {
  const clip = item.actions.get(name)?.getClip()
  const lift = item.lift.get(name) ?? 0
  const parts = [`${ACTION_LABEL[name] ?? name}`, clip ? `長 ${clip.duration.toFixed(2)} 秒` : '']
  if (lift > 0.02) {
    parts.push(
      `離地 ${lift.toFixed(2)} 個身高${lift > RANCH_MAX_HOVER ? `（牧場裡壓到 ${RANCH_MAX_HOVER}，不會飛出牧場）` : ''}`,
    )
  } else if (lift < -0.02) {
    parts.push(`比待機低 ${(-lift).toFixed(2)} 個身高（牧場裡會抬回地面）`)
  }
  infoEl.textContent = parts.filter(Boolean).join(' · ')
}

// ── 畫面 ─────────────────────────────────────────────

function renderHeader(s: ShowcaseSpecies): void {
  noEl.textContent = `#${s.id}`
  nameEl.textContent = s.name
  iconEl.hidden = false
  iconEl.src = s.iconUrl
  iconEl.onerror = () => (iconEl.hidden = true)
  document.title = `#${s.id} ${s.name} · 動作圖鑑`
  const badges: string[] = [`${s.animations.length} 個動作`]
  if (!hasSleep(s)) badges.push('沒有睡覺動作：在牧場上不會睡著')
  badgesEl.replaceChildren(
    ...badges.map((t, i) => {
      const span = document.createElement('span')
      span.className = i > 0 ? 'badge warn' : 'badge'
      span.textContent = t
      return span
    }),
  )
}

function renderActions(s: ShowcaseSpecies, current: string | null): void {
  const ready = loaded?.species === s
  actionsEl.replaceChildren(
    ...ACTION_ORDER.map((name, i) => {
      const b = document.createElement('button')
      b.className = 'chip action-chip'
      const has = ready ? loaded!.actions.has(name) : s.animations.some((a) => a.name === name)
      const duration = s.animations.find((a) => a.name === name)?.duration
      b.disabled = !ready || !has
      b.setAttribute('aria-pressed', String(name === current))
      b.innerHTML = `<kbd>${i + 1}</kbd>${ACTION_LABEL[name]}<small>${has ? (duration ? `${duration.toFixed(1)}s` : name) : '沒有'}</small>`
      b.title = has ? `${name}` : `${s.name}沒有 ${name} 動作`
      b.addEventListener('click', () => play(name))
      return b
    }),
  )
  if (!ready) infoEl.textContent = ''
}

let activeId: string | null = null

function select(id: string, scroll = false): void {
  const s = species.find((x) => x.id === id)
  if (!s) return
  activeId = id
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`)
  for (const li of listEl.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
    const on = li.dataset.id === id
    li.setAttribute('aria-current', on ? 'true' : 'false')
    // 只捲清單本身（scrollIntoView 會連整頁一起捲，手機上會把檢視器捲走）
    if (on && scroll) {
      const r = li.getBoundingClientRect()
      const box = listEl.getBoundingClientRect()
      if (r.top < box.top) listEl.scrollTop -= box.top - r.top
      else if (r.bottom > box.bottom) listEl.scrollTop += r.bottom - box.bottom
    }
  }
  void show(s)
}

function matches(s: ShowcaseSpecies, q: string): boolean {
  if (filter === 'sleep' && !hasSleep(s)) return false
  if (filter === 'nosleep' && hasSleep(s)) return false
  if (!q) return true
  const num = q.replace(/^#/, '')
  if (/^\d+$/.test(num)) return s.id.includes(num.padStart(Math.min(3, num.length), '0')) || Number(s.id) === Number(num)
  return s.name.includes(q)
}

function renderList(): void {
  const q = searchEl.value.trim()
  const shown = species.filter((s) => matches(s, q))
  listEl.replaceChildren(
    ...shown.map((s) => {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.dataset.id = s.id
      b.setAttribute('aria-current', s.id === activeId ? 'true' : 'false')
      const img = document.createElement('img')
      img.src = s.iconUrl
      img.alt = ''
      img.loading = 'lazy'
      img.onerror = () => img.classList.add('missing')
      const no = document.createElement('span')
      no.className = 'li-no'
      no.textContent = `#${s.id}`
      const name = document.createElement('span')
      name.className = 'li-name'
      name.textContent = s.name
      b.append(img, no, name)
      if (!hasSleep(s)) {
        const z = document.createElement('span')
        z.className = 'li-flag'
        z.title = '沒有睡覺動作'
        z.textContent = '不睡'
        b.append(z)
      }
      b.addEventListener('click', () => select(s.id))
      li.append(b)
      return li
    }),
  )
  countEl.textContent = q || filter !== 'all' ? `找到 ${shown.length} 隻（共 ${species.length} 隻）` : `共 ${species.length} 隻`
}

// ── 事件 ─────────────────────────────────────────────

searchEl.addEventListener('input', renderList)
searchEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  const first = listEl.querySelector<HTMLButtonElement>('button[data-id]')
  if (first) select(first.dataset.id!)
})
for (const b of filterButtons) {
  b.addEventListener('click', () => {
    filter = b.dataset.filter as typeof filter
    for (const x of filterButtons) x.setAttribute('aria-pressed', String(x === b))
    renderList()
  })
}

function setPaused(next: boolean): void {
  paused = next
  pauseButton.setAttribute('aria-pressed', String(paused))
  pauseButton.textContent = paused ? '繼續' : '暫停'
}
pauseButton.addEventListener('click', () => setPaused(!paused))
for (const b of speedButtons) {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed)
    for (const x of speedButtons) x.setAttribute('aria-pressed', String(x === b))
  })
}
rotateButton.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate
  rotateButton.setAttribute('aria-pressed', String(controls.autoRotate))
})
resetButton.addEventListener('click', () => {
  if (loaded) frameCamera(loaded.width)
})

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
  const n = Number(e.key)
  if (n >= 1 && n <= ACTION_ORDER.length) {
    play(ACTION_ORDER[n - 1])
  } else if (e.key === ' ') {
    e.preventDefault()
    setPaused(!paused)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const ids = [...listEl.querySelectorAll<HTMLButtonElement>('button[data-id]')].map((b) => b.dataset.id!)
    const i = activeId ? ids.indexOf(activeId) : -1
    const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next && next !== activeId) {
      e.preventDefault()
      select(next, true)
    }
  }
})

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1)
  if (id && id !== activeId) select(id, true)
})

// ── 動畫迴圈 ─────────────────────────────────────────

const timer = new THREE.Timer()
timer.connect(document)

function frame(time: number): void {
  requestAnimationFrame(frame)
  timer.update(time)
  const dt = Math.min(timer.getDelta(), 0.1)
  if (loaded) {
    loaded.mixer.update(paused ? 0 : dt * speed)
    const clip = loaded.current?.getClip()
    if (clip && loaded.current) progressEl.style.width = `${((loaded.current.time / clip.duration) * 100).toFixed(1)}%`
  }
  controls.update(dt)
  renderer.render(scene, camera)
}
requestAnimationFrame(frame)

// ── 開始 ─────────────────────────────────────────────

fetchSpecies()
  .then((list) => {
    species = list.species
    renderList()
    if (species.length === 0) {
      setStatus('找不到寶可夢模型：照 README 的「準備模型」把模型放進 agent-pets/models/，再重開展示網站')
      return
    }
    const fromHash = location.hash.slice(1)
    select(species.some((s) => s.id === fromHash) ? fromHash : (species.find((s) => s.id === '025') ?? species[0]).id, true)
  })
  .catch((err) => {
    console.error(err)
    setStatus('讀不到品種清單：請用 npm run showcase 開這個網站')
  })
