/**
 * 雪地地圖的東西（2026-11-12 使用者「新地貌雪地，用中央湖改」；ranch-maps.ts 的 snow）。
 *
 * 同一天使用者「雪地你重構一版」→ 重新設計成雪國小屋（中央的湖照使用者調過的樣子，不動）：
 * - 小木屋：頂角一間圓木屋，屋頂積雪、窗戶亮著暖光、煙囪冒煙，旁邊有柴堆和雪橇。整片冷色裡唯一的暖色，是畫面的重點
 * - 松林：後緣（畫面上方兩條邊）一整排高高低低的積雪松樹當背景，前面只留兩棵小的
 * - 雪屋（かまくら）：右角一座，洞口朝畫面左下、亮著暖光
 * - 路燈與小路：從木門沿左上邊到小木屋，一條鏟過雪的小路（地面顏色，ranch-scene.ts 照 map.path 混），旁邊幾盞暖光的路燈
 * - 白樺、積雪的石頭、雪人、雪丘、湖面的浮冰、柵欄柱頭的積雪、慢慢飄下來的雪
 *
 * 都用程式產生，不用圖檔。每樣東西的位置在 ranch-maps.ts 的 SnowVillage。
 * 地面的雪色、湖岸的碎石色在 ranch-scene.ts 的 buildIsland（照 map.theme 換配色）。
 */
import * as THREE from 'three'

import { Batch, flat, placed, rand } from './batch'
import { WATER_Y } from './lake'
import type { RanchMap } from './ranch-maps'

/**
 * 雪地的地面配色（ranch-scene.ts 的 buildIsland 用）：雪、雪的陰影、湖岸碎石（乾、濕）、湖底（淺、深）。
 * 2026-11-12 使用者「湖有點綠，改成透明藍」：湖底原本沿用草地地圖的青苔綠，透過半透明水面看起來偏綠 → 改冰藍、深藍
 */
export const SNOW_GROUND = {
  snow: 0xf1f5f9,
  snow2: 0xdbe5ee,
  shore: 0xc4cfd9,
  shoreWet: 0xa3b2bf,
  bedShallow: 0x9fd0ea,
  bedDeep: 0x2c79b8,
  /** 鏟過雪的小路：踩實的雪，比旁邊暗一點、藍一點 */
  path: 0xb3c4d5,
}
/** 柵欄、木門：比草地地圖的淺色木頭深一點，在一片白裡才不會太跳 */
export const SNOW_WOOD = { fence: 0x9a7350, gate: 0x74513a }
/** 雪地的水面：亮一點的透明藍（透明度 SNOW_WATER_OPACITY，一般的湖是 0.6） */
export const SNOW_WATER = 0x5cbcf2
export const SNOW_WATER_OPACITY = 0.5

const SNOW_WHITE = 0xf7fafc

/** 暖光：小木屋的窗、雪屋的洞口、路燈 */
const WARM = { color: 0xffe0a3, emissive: 0xffb955 }

interface PineMats {
  trunk: THREE.Material
  leaves: THREE.Material[]
  snow: THREE.Material
}

/** 積雪的松樹：樹幹＋四層由大到小的深綠圓錐，每層上半截蓋一頂白色的雪。高約 2.4 × size */
function snowPine(b: Batch, mats: PineMats, x: number, z: number, size: number): void {
  const base = placed(x, z, rand(0, Math.PI * 2), size)
  b.put(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), mats.trunk, base, new THREE.Vector3(0, 0.3, 0))
  const tiers: [number, number, number][] = [
    [0.5, 0.74, 0.8],
    [0.95, 0.6, 0.74],
    [1.38, 0.45, 0.66],
    [1.78, 0.3, 0.6],
  ]
  tiers.forEach(([y, r, h], i) => {
    b.put(new THREE.ConeGeometry(r, h, 8), mats.leaves[i % 2], base, new THREE.Vector3(0, y + h / 2, 0))
    // 雪：同一層圓錐的上半截，稍微大一點點蓋在上面；最上面那層整個是白的
    const top = i === tiers.length - 1
    b.put(new THREE.ConeGeometry(r * (top ? 0.86 : 0.66), h * (top ? 0.86 : 0.56), 8), mats.snow, base, new THREE.Vector3(0, y + h * (top ? 0.6 : 0.74), 0))
  })
}

/** 雪人：三顆雪球、炭黑的眼睛和釦子、紅蘿蔔鼻子、紅圍巾、樹枝手。面向等角鏡頭（右前方） */
export function buildSnowman(world: THREE.Object3D, x: number, z: number): void {
  const g = new THREE.Group()
  const snow = new THREE.MeshStandardMaterial({ color: SNOW_WHITE, roughness: 0.75 })
  const coal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 })
  const balls: [number, number][] = [
    [0.34, 0.3],
    [0.25, 0.78],
    [0.18, 1.12],
  ]
  for (const [r, y] of balls) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), snow)
    ball.position.y = y
    ball.scale.y = 0.94
    g.add(ball)
  }
  // 眼睛、釦子（在 +z 那一面）
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), coal)
    eye.position.set(sx * 0.065, 1.17, 0.16)
    g.add(eye)
  }
  for (const y of [0.7, 0.82]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), coal)
    button.position.set(0, y, 0.245)
    g.add(button)
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0xf08a2c, roughness: 0.7 }))
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.11, 0.25)
  g.add(nose)
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 8, 20), new THREE.MeshStandardMaterial({ color: 0xd8423a, roughness: 0.9 }))
  scarf.rotation.x = Math.PI / 2
  scarf.position.y = 0.97
  g.add(scarf)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.03), scarf.material)
  tail.position.set(0.1, 0.87, 0.15)
  tail.rotation.z = 0.2
  g.add(tail)
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 })
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.42, 5), wood)
    arm.position.set(sx * 0.38, 0.86, 0)
    arm.rotation.z = sx * -1.0
    g.add(arm)
  }
  g.position.set(x, 0, z)
  // 比原本大三成：原本在整片雪地上小到看不太到
  g.scale.setScalar(1.3)
  // 鏡頭在右前方（+x、+z）：臉轉 45° 朝它
  g.rotation.y = Math.PI / 4
  world.add(g)
}

/** 雪丘：陸地上零星幾堆壓扁的白色半球（很小，不擋路） */
export function buildSnowMounds(world: THREE.Object3D, spot: () => THREE.Vector3, count = 14): void {
  const mat = new THREE.MeshStandardMaterial({ color: SNOW_WHITE, roughness: 0.85 })
  const geo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  for (let i = 0; i < count; i++) {
    const p = spot()
    const mound = new THREE.Mesh(geo, mat)
    const r = 0.18 + Math.random() * 0.22
    mound.scale.set(r * (1 + Math.random() * 0.5), r * 0.45, r)
    mound.rotation.y = Math.random() * Math.PI
    mound.position.set(p.x, -0.01, p.z)
    world.add(mound)
  }
}

/** 湖面浮冰的片數（2026-11-13 使用者：「水上的浮冰太多了 移除一半」，16 → 8） */
const ICE_FLOES = 8

/** 湖面的小浮冰：靠岸的地方幾片白藍色的薄冰（裝飾，不擋水系） */
export function buildIceFloes(world: THREE.Object3D, water: (x: number, z: number) => number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8f3fa, roughness: 0.35, transparent: true, opacity: 0.92, flatShading: true })
  let placed = 0
  for (let i = 0; i < 900 && placed < ICE_FLOES; i++) {
    const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX)
    const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ)
    const d = water(x, z)
    if (d < 0.35 || d > 1.3) continue
    const r = 0.16 + Math.random() * 0.3
    const floe = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.035, 5 + Math.floor(Math.random() * 3)), mat)
    floe.position.set(x, WATER_Y + 0.012, z)
    floe.rotation.y = Math.random() * Math.PI
    floe.scale.z = 0.7 + Math.random() * 0.4
    floe.renderOrder = 2
    world.add(floe)
    placed++
  }
}

/** 柵欄柱頭的積雪：一小塊圓圓扁扁的白色 */
export function snowCap(post: THREE.Object3D, top: number): THREE.Mesh {
  const cap = new THREE.Mesh(snowCapGeo, snowCapMat)
  cap.position.set(post.position.x, top + 0.015, post.position.z)
  cap.scale.y = 0.45
  return cap
}
const snowCapGeo = new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
const snowCapMat = new THREE.MeshStandardMaterial({ color: SNOW_WHITE, roughness: 0.85 })

/** 小圓點貼圖（雪花用）：中間白、邊緣淡出 */
function flakeTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 飄落的東西長什麼樣子：顏色、像素大小、落下速度（最小、最大）、左右晃多大、貼圖（雪花圓點、櫻花瓣） */
export interface FallLook {
  color: number
  size: number
  speed: [number, number]
  sway: number
  texture: () => THREE.Texture
}

const SNOW_LOOK: FallLook = { color: 0xffffff, size: 3.2, speed: [0.35, 0.7], sway: 0.12, texture: flakeTexture }

/**
 * 飄雪：小島上方一個盒子裡幾百片雪花，慢慢往下飄、左右輕輕晃，掉到地面就從上面重新開始。
 * 正交鏡頭沒有遠近，雪花固定幾個像素大（sizeAttenuation 關掉）。RanchScene.render 每格呼叫 update。
 * 賞櫻地圖也用它飄花瓣（look 換成花瓣，sakura.ts 的 PETAL_LOOK）。
 */
export class Snowfall {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly phase: Float32Array
  private readonly speed: Float32Array
  private time = 0
  private readonly box: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }
  private readonly sway: number

  constructor(box: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }, count = 520, look: FallLook = SNOW_LOOK) {
    this.box = box
    this.sway = look.sway
    this.pos = new Float32Array(count * 3)
    this.phase = new Float32Array(count)
    this.speed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.respawn(i, Math.random() * box.top)
      this.phase[i] = Math.random() * Math.PI * 2
      this.speed[i] = look.speed[0] + Math.random() * (look.speed[1] - look.speed[0])
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const mat = new THREE.PointsMaterial({
      color: look.color,
      size: look.size,
      sizeAttenuation: false,
      map: look.texture(),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  private respawn(i: number, y: number): void {
    const { minX, maxX, minZ, maxZ } = this.box
    this.pos[i * 3] = minX + Math.random() * (maxX - minX)
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = minZ + Math.random() * (maxZ - minZ)
  }

  update(dt: number): void {
    this.time += dt
    const n = this.speed.length
    for (let i = 0; i < n; i++) {
      this.pos[i * 3 + 1] -= this.speed[i] * dt
      // 左右輕輕晃（沿畫面的水平方向：x 加、z 減）
      const sway = Math.sin(this.time * 0.9 + this.phase[i]) * this.sway * dt
      this.pos[i * 3] += sway
      this.pos[i * 3 + 2] -= sway
      if (this.pos[i * 3 + 1] < 0) this.respawn(i, this.box.top)
    }
    this.points.geometry.attributes.position.needsUpdate = true
  }
}

// ── 雪國小屋（2026-11-12 重新設計）────────────────────

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface VillageObstacle {
  x: number
  z: number
  r: number
}

function glowMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: WARM.color, emissive: WARM.emissive, emissiveIntensity: 1.1, roughness: 0.6 })
}

/** 暖光照在雪地上的那一圈：中間亮、往外淡出的圓（貼在地上，不寫深度） */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,205,120,0.62)')
  grad.addColorStop(0.45, 'rgba(255,196,110,0.3)')
  grad.addColorStop(1, 'rgba(255,190,100,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function groundGlow(world: THREE.Object3D, tex: THREE.Texture, x: number, z: number, r: number): void {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  disc.position.set(x, 0.014, z)
  disc.renderOrder = 1
  world.add(disc)
}

/**
 * 小木屋：圓木牆、積雪的山形屋頂、石頭煙囪與幾團煙、門、兩扇亮著的窗、牆邊的柴堆。
 * 長邊沿 x（寬 2.4）、深 1.8；門和一扇窗在 +z 那一面、另一扇窗在 +x 那一面，等角鏡頭剛好看得到這兩面
 */
function cabin(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  const base = placed(x, z)
  const W = 2.4
  const D = 1.8
  const H = 1.2
  const RISE = 0.95
  const log = flat(0x8f5d38, 0.95)
  const dark = flat(0x6c442a, 0.95)
  const trim = flat(0x4b2f1f, 0.9)
  const snow = flat(SNOW_WHITE, 0.85)
  const stone = flat(0x8b8f96, 1)
  const glow = glowMat()
  b.put(new THREE.BoxGeometry(W - 0.1, H, D - 0.1), dark, base, new THREE.Vector3(0, H / 2, 0))
  // 看得到的兩面各一排橫的圓木
  for (let i = 0; i < 6; i++) {
    const y = 0.1 + i * 0.2
    b.put(new THREE.CylinderGeometry(0.1, 0.1, W + 0.16, 7), log, base, new THREE.Vector3(0, y, D / 2 - 0.03), new THREE.Euler(0, 0, Math.PI / 2))
    b.put(new THREE.CylinderGeometry(0.1, 0.1, D + 0.16, 7), log, base, new THREE.Vector3(W / 2 - 0.03, y, 0), new THREE.Euler(Math.PI / 2, 0, 0))
  }
  // 山牆（±x 兩面的三角形）
  const tri = new THREE.Shape()
  tri.moveTo(-D / 2, 0)
  tri.lineTo(D / 2, 0)
  tri.lineTo(0, RISE)
  tri.closePath()
  for (const sx of [-1, 1]) {
    b.put(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), log, base, new THREE.Vector3(sx > 0 ? W / 2 - 0.08 : -W / 2 - 0.02, H, 0), new THREE.Euler(0, Math.PI / 2, 0))
  }
  // 屋頂：兩片斜板，上面各一層厚厚的雪；屋脊再一條雪
  const run = D / 2 + 0.32
  const pitch = Math.atan2(RISE, D / 2)
  const len = run / Math.cos(pitch)
  for (const sz of [-1, 1]) {
    const mid = new THREE.Vector3(0, H + RISE - (run / 2) * Math.tan(pitch) + 0.03, (sz * run) / 2)
    const tilt = new THREE.Euler(sz * pitch, 0, 0)
    b.put(new THREE.BoxGeometry(W + 0.5, 0.07, len), trim, base, mid, tilt)
    const up = new THREE.Vector3(0, Math.cos(pitch), sz * Math.sin(pitch)).multiplyScalar(0.11)
    b.put(new THREE.BoxGeometry(W + 0.58, 0.17, len + 0.08), snow, base, mid.clone().add(up), tilt)
  }
  b.put(new THREE.CylinderGeometry(0.15, 0.15, W + 0.58, 7), snow, base, new THREE.Vector3(0, H + RISE + 0.12, 0), new THREE.Euler(0, 0, Math.PI / 2))
  // 煙囪（屋脊後面一點）＋雪帽＋往右上飄的幾團煙
  const chimney = new THREE.Vector3(-0.65, H + RISE + 0.12, -0.3)
  b.put(new THREE.BoxGeometry(0.36, 0.8, 0.36), stone, base, chimney)
  b.put(new THREE.BoxGeometry(0.44, 0.09, 0.44), snow, base, chimney.clone().add(new THREE.Vector3(0, 0.44, 0)))
  const smoke = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 1, flatShading: true, transparent: true, opacity: 0.86 })
  ;[
    [0.05, 0.72, 0.17],
    [0.2, 1.08, 0.23],
    [0.42, 1.5, 0.3],
    [0.7, 1.98, 0.36],
  ].forEach(([dx, dy, r]) => b.put(new THREE.IcosahedronGeometry(r, 1), smoke, base, chimney.clone().add(new THREE.Vector3(dx, dy, dx * 0.4))))
  // 門（+z 面）、門前的石階
  b.put(new THREE.BoxGeometry(0.46, 0.82, 0.06), trim, base, new THREE.Vector3(0.5, 0.43, D / 2 + 0.09))
  b.put(new THREE.SphereGeometry(0.03, 8, 6), glow, base, new THREE.Vector3(0.36, 0.42, D / 2 + 0.13))
  b.put(new THREE.BoxGeometry(0.66, 0.08, 0.3), stone, base, new THREE.Vector3(0.5, 0.04, D / 2 + 0.28))
  // 窗：深色的框、亮著的玻璃、十字窗櫺；+z 面一扇、+x 面一扇
  const windowAt = (p: THREE.Vector3, rotY: number) => {
    const turn = new THREE.Euler(0, rotY, 0)
    b.put(new THREE.BoxGeometry(0.56, 0.5, 0.05), trim, base, p, turn)
    const out = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY))
    b.put(new THREE.BoxGeometry(0.44, 0.38, 0.05), glow, base, p.clone().addScaledVector(out, 0.012), turn)
    b.put(new THREE.BoxGeometry(0.44, 0.035, 0.05), trim, base, p.clone().addScaledVector(out, 0.022), turn)
    b.put(new THREE.BoxGeometry(0.035, 0.38, 0.05), trim, base, p.clone().addScaledVector(out, 0.022), turn)
    // 窗台上的雪
    b.put(new THREE.BoxGeometry(0.6, 0.06, 0.12), snow, base, p.clone().add(new THREE.Vector3(0, -0.28, 0)).addScaledVector(out, 0.03), turn)
  }
  windowAt(new THREE.Vector3(-0.55, 0.72, D / 2 + 0.085), 0)
  windowAt(new THREE.Vector3(W / 2 + 0.085, 0.72, 0.3), Math.PI / 2)
  // 柴堆：靠 +x 那面牆的後半，圓木的切面朝外，上面蓋雪
  const woodEnd = flat(0xc9a06b, 0.95)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4 - row; col++) {
      const p = new THREE.Vector3(W / 2 + 0.3, 0.08 + row * 0.14, -0.78 + col * 0.16 + row * 0.08)
      b.put(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 7), row % 2 ? dark : log, base, p, new THREE.Euler(0, 0, Math.PI / 2))
      b.put(new THREE.CylinderGeometry(0.055, 0.055, 0.43, 7), woodEnd, base, p, new THREE.Euler(0, 0, Math.PI / 2))
    }
  }
  b.put(new THREE.BoxGeometry(0.46, 0.06, 0.5), snow, base, new THREE.Vector3(W / 2 + 0.3, 0.5, -0.5))
  b.build(world)
}

/**
 * 雪屋洞口的方向（繞 y 轉的角度，local 的 +z 是洞口）。
 * 原本轉 45° 朝鏡頭（畫面右下）；2026-11-12 使用者「右邊的雪屋 門口朝左」→ 0：朝 +z，畫面上是左下、往小島中間。
 * 不用 -45°（正左）：那樣洞口跟視線垂直，只看得到拱道的側面，看不到裡面的燈
 */
const IGLOO_ROT = 0
/** 洞口朝向的水平方向（世界座標的單位向量） */
const IGLOO_DOOR = { x: Math.sin(IGLOO_ROT), z: Math.cos(IGLOO_ROT) }

/** 雪屋（かまくら）：一座雪堆成的圓頂，洞口朝 IGLOO_ROT，裡面亮著暖光 */
function igloo(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  const base = placed(x, z, IGLOO_ROT)
  // 比地上的雪藍一點，不然白底上看不出形狀；再加兩圈淡淡的橫紋當雪磚的接縫
  const snow = flat(0xdde9f3, 0.85)
  b.put(new THREE.SphereGeometry(1.05, 11, 5, 0, Math.PI * 2, 0, Math.PI / 2), snow, base, new THREE.Vector3(0, -0.02, 0), undefined, new THREE.Vector3(1, 0.92, 1))
  const seam = flat(0xbccddd, 0.9)
  for (const [y, r] of [
    [0.36, 0.985],
    [0.66, 0.79],
  ]) {
    b.put(new THREE.TorusGeometry(r, 0.018, 4, 22), seam, base, new THREE.Vector3(0, y, 0), new THREE.Euler(Math.PI / 2, 0, 0))
  }
  // 洞口：往外伸的一小段拱道，裡面是暗的，再往裡亮著燈
  b.put(new THREE.CylinderGeometry(0.47, 0.47, 0.8, 10), snow, base, new THREE.Vector3(0, 0.1, 0.95), new THREE.Euler(Math.PI / 2, 0, 0))
  b.put(new THREE.CircleGeometry(0.37, 16), new THREE.MeshStandardMaterial({ color: 0x3a3240, roughness: 1 }), base, new THREE.Vector3(0, 0.14, 1.352))
  b.put(new THREE.CircleGeometry(0.27, 16), glowMat(), base, new THREE.Vector3(0, 0.1, 1.356))
  b.build(world)
}

/** 路燈：木頭柱子、往鏡頭伸出去的橫桿、底下掛一盞亮著的燈，柱頂和燈頂有雪 */
function lampPost(b: Batch, mats: { wood: THREE.Material; snow: THREE.Material; glow: THREE.Material; cap: THREE.Material }, x: number, z: number): void {
  // 轉 -45°：local 的 +x 朝鏡頭
  const base = placed(x, z, -Math.PI / 4)
  b.put(new THREE.BoxGeometry(0.1, 1.5, 0.1), mats.wood, base, new THREE.Vector3(0, 0.75, 0))
  b.put(new THREE.BoxGeometry(0.42, 0.06, 0.06), mats.wood, base, new THREE.Vector3(0.17, 1.42, 0))
  b.put(new THREE.SphereGeometry(0.075, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mats.snow, base, new THREE.Vector3(0, 1.5, 0))
  b.put(new THREE.BoxGeometry(0.2, 0.24, 0.2), mats.glow, base, new THREE.Vector3(0.32, 1.2, 0))
  b.put(new THREE.ConeGeometry(0.2, 0.12, 4), mats.cap, base, new THREE.Vector3(0.32, 1.38, 0), new THREE.Euler(0, Math.PI / 4, 0))
  b.put(new THREE.ConeGeometry(0.13, 0.07, 4), mats.snow, base, new THREE.Vector3(0.32, 1.43, 0), new THREE.Euler(0, Math.PI / 4, 0))
  b.put(new THREE.BoxGeometry(0.22, 0.03, 0.22), mats.cap, base, new THREE.Vector3(0.32, 1.07, 0))
}

/** 白樺：細細的白樹幹上幾圈深色的橫紋，葉子掉光了，只剩往上的細枝，枝頭沾一點雪 */
function birch(b: Batch, mats: { bark: THREE.Material; mark: THREE.Material; twig: THREE.Material; snow: THREE.Material }, x: number, z: number, size: number): void {
  const base = placed(x, z, rand(0, Math.PI * 2), size)
  const top = new THREE.Vector3(rand(-0.08, 0.08), 2.4, rand(-0.08, 0.08))
  b.rod(mats.bark, base, new THREE.Vector3(0, 0, 0), top, 0.075, 0.03, 7)
  for (const y of [0.35, 0.8, 1.15, 1.6]) {
    const r = 0.078 - y * 0.018
    b.put(new THREE.CylinderGeometry(r, r, 0.035, 7), mats.mark, base, new THREE.Vector3((top.x * y) / 2.4, y, (top.z * y) / 2.4))
  }
  for (let i = 0; i < 7; i++) {
    const y = 1.0 + i * 0.2
    const a = i * 2.4 + rand(-0.3, 0.3)
    const from = new THREE.Vector3((top.x * y) / 2.4, y, (top.z * y) / 2.4)
    const len = rand(0.45, 0.8) * (1 - i * 0.07)
    const tip = from.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.75, len * 0.7, Math.sin(a) * len * 0.75))
    b.rod(mats.twig, base, from, tip, 0.022, 0.008, 4)
    if (i % 2 === 0) b.put(new THREE.IcosahedronGeometry(0.06, 0), mats.snow, base, from.clone().lerp(tip, 0.55).add(new THREE.Vector3(0, 0.03, 0)), undefined, new THREE.Vector3(1.3, 0.6, 1.3))
  }
}

/** 雪橇：兩條前端翹起來的滑軌、紅色的坐板 */
function sled(world: THREE.Object3D, x: number, z: number, rot: number): void {
  const b = new Batch()
  const base = placed(x, z, rot)
  const runner = flat(0x5a3b28, 0.9)
  const seat = flat(0xc8423a, 0.85)
  for (const sz of [-1, 1]) {
    b.put(new THREE.BoxGeometry(0.9, 0.04, 0.05), runner, base, new THREE.Vector3(0, 0.03, sz * 0.2))
    b.put(new THREE.BoxGeometry(0.26, 0.04, 0.05), runner, base, new THREE.Vector3(0.53, 0.1, sz * 0.2), new THREE.Euler(0, 0, 0.7))
    for (const sx of [-0.25, 0.25]) b.put(new THREE.BoxGeometry(0.04, 0.14, 0.04), runner, base, new THREE.Vector3(sx, 0.11, sz * 0.2))
  }
  for (const sz of [-0.15, 0, 0.15]) b.put(new THREE.BoxGeometry(0.72, 0.03, 0.12), seat, base, new THREE.Vector3(-0.02, 0.195, sz))
  b.build(world)
}

/**
 * 蓋整座雪國小屋（ranch-scene.ts 的 build 呼叫）：松林、小木屋、雪屋、路燈、白樺、石頭、雪橇、雪人。回傳寵物要繞開的東西
 */
export function buildSnowVillage(world: THREE.Object3D, map: RanchMap): VillageObstacle[] {
  const obstacles: VillageObstacle[] = []
  const snow = flat(SNOW_WHITE, 0.85)

  const pines = new Batch()
  const pineMats: PineMats = {
    trunk: new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 1 }),
    leaves: [flat(0x2f5e45, 0.9), flat(0x285340, 0.9)],
    snow,
  }
  for (const [x, z, size] of map.trees) {
    snowPine(pines, pineMats, x, z, size)
    obstacles.push({ x, z, r: 0.35 * size })
  }
  pines.build(world)

  if (map.snowman) {
    const [x, z] = map.snowman
    buildSnowman(world, x, z)
    obstacles.push({ x, z, r: 0.5 })
  }

  const village = map.village
  if (!village) return obstacles
  const glowTex = glowTexture()

  const [cx, cz] = village.cabin
  cabin(world, cx, cz)
  // 小木屋的佔地用三個圓蓋住（屋子本體兩個、+x 那面的柴堆一個）
  obstacles.push({ x: cx - 0.6, z: cz, r: 1.1 }, { x: cx + 0.6, z: cz, r: 1.1 }, { x: cx + 1.5, z: cz - 0.5, r: 0.45 })
  groundGlow(world, glowTex, cx - 0.05, cz + 1.75, 1.35)
  groundGlow(world, glowTex, cx + 1.95, cz + 0.4, 1.0)

  const [ix, iz] = village.igloo
  igloo(world, ix, iz)
  // 圓頂一個圓、往洞口伸出去的拱道一個圓；洞口前的地上一圈暖光
  obstacles.push({ x: ix, z: iz, r: 1.1 }, { x: ix + 0.99 * IGLOO_DOOR.x, z: iz + 0.99 * IGLOO_DOOR.z, r: 0.5 })
  groundGlow(world, glowTex, ix + 1.9 * IGLOO_DOOR.x, iz + 1.9 * IGLOO_DOOR.z, 0.95)

  const small = new Batch()
  const lampMats = { wood: flat(0x6c442a, 0.95), snow, glow: glowMat(), cap: flat(0x3a3f47, 0.8) }
  for (const [x, z] of village.lamps) {
    lampPost(small, lampMats, x, z)
    obstacles.push({ x, z, r: 0.2 })
    // 燈掛在柱子往鏡頭那一側 0.32 的地方
    groundGlow(world, glowTex, x + 0.23, z + 0.23, 1.05)
  }
  const birchMats = { bark: flat(0xebe7df, 0.9), mark: flat(0x4a4744, 1), twig: flat(0xbdb6ab, 1), snow }
  for (const [x, z, size] of village.birches) {
    birch(small, birchMats, x, z, size)
    obstacles.push({ x, z, r: 0.18 })
  }
  // 積雪的石頭：灰色的石頭上蓋一頂壓扁的雪
  const rockMat = flat(0x858b93, 1)
  const id = new THREE.Matrix4()
  for (const [x, z, s] of village.rocks) {
    small.put(new THREE.DodecahedronGeometry(s, 0), rockMat, id, new THREE.Vector3(x, s * 0.34, z), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.75, 1))
    small.put(new THREE.SphereGeometry(s * 0.82, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), snow, id, new THREE.Vector3(x, s * 0.5, z), undefined, new THREE.Vector3(1, 0.5, 1))
    obstacles.push({ x, z, r: s * 0.85 })
  }
  small.build(world)

  const [sx, sz, srot] = village.sled
  sled(world, sx, sz, srot)
  obstacles.push({ x: sx, z: sz, r: 0.5 })
  return obstacles
}
