/**
 * 火山口湖的設計預覽（2026-11-12 使用者「中央湖改為火山口湖，不用改，先給我 HTML DEMO 版」；
 * 同一天「能否火山往上移、高出來」→ 整座火山隆起，火口湖在山頂，高度與前後位置用拉桿調；
 * 「火山口再大一些，讓水多一點」→ 湖的半徑預設從約 2.8 加大到 4，也做成拉桿）。
 *
 * 2026-11-12 使用者選定後已經做進牧場（src/ranch-maps.ts 的 CRATER、src/volcano.ts）；這一頁留著，之後想再調形狀可以先在這裡試。
 * 🔴 這一頁本身不會改到牧場：拉桿只影響這一頁。這一頁借牧場本體的 RanchScene 蓋出一座沒有水的小島和柵欄，
 * 再在這一頁裡自己把地面隆起成火山、重新上色、鋪一片山頂的湖水、擺石頭和蒸氣。確定要做的時候，才把這裡的做法搬進 src/。
 *
 * 做法：
 * - 只在這一頁的記憶體裡把 MAPS['lake-center'] 換成「沒有水」的地圖（不寫回任何檔案），讓 RanchScene 蓋一座平的小島
 * - 蓋好之後拿掉草叢、花這些草地地圖的裝飾，自己算每個地面頂點的高度與顏色
 * - 兩種風格：休火山（長草的山坡、翠綠的湖）、活火山（深色火山岩、濃煙；原本有熔岩裂縫，使用者說不要岩漿，拿掉了）
 * - 2026-11-12 使用者選定：活火山、湖的大小 3.6、火山高度 1.9、往後移 1.2（現在的預設值）
 */
import * as THREE from 'three'

import { Batch, flat, rand } from '../src/batch'
import { bedOf, WATER_Y } from '../src/lake'
import { edgeDist, MAPS } from '../src/ranch-maps'
import { RanchScene } from '../src/ranch-scene'

type Variant = 'dormant' | 'active'

// ── 形狀 ─────────────────────────────────────────────

/** 拉桿調的三個數字：size 湖的半徑、lift 湖面比平地高多少、back 火山往後（畫面上方）移多少 */
const params = { size: 3.6, lift: 1.9, back: 1.2 }
const smooth = THREE.MathUtils.smoothstep
const lerp = THREE.MathUtils.lerp

/**
 * 實際往後移了多少：湖連同火口緣要留在小島裡面（小島半邊 8.2），所以湖越大，能移的越少
 */
const backShift = (): number => Math.max(0, Math.min(params.back, 6.1 - params.size * 1.12 - 0.85))
/** 火山口的中心：back = 0 時在小島中間偏上（跟原本的中央湖一樣），越大越靠頂角 */
const center = () => ({ x: -0.8 - backShift(), z: -0.9 - backShift() })
/** 湖的半徑（拉桿調的 size）：大致是圓的，邊緣有一點不規則 */
const radiusAt = (a: number): number => params.size * (1 + 0.07 * Math.sin(3 * a + 0.5) + 0.05 * Math.sin(5 * a + 1.0))
const polar = (x: number, z: number) => {
  const c = center()
  const dx = x - c.x
  const dz = z - c.z
  return { r: Math.hypot(dx, dz), a: Math.atan2(dz, dx) }
}
/** 離湖岸多遠：> 0 在湖裡（跟牧場本體的水域距離一樣的約定） */
const lakeDist = (x: number, z: number): number => {
  const { r, a } = polar(x, z)
  return radiusAt(a) - r
}
/** 火口緣的兩個缺口朝哪裡（弧度）：正前方（往鏡頭）、左邊 */
const NOTCHES = [0.8, 2.75]
/** 這個方向的火口緣剩多高（0 = 缺口，1 = 完整） */
const notch = (a: number): number => {
  let n = 1
  for (const c of NOTCHES) {
    const da = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)))
    n = Math.min(n, smooth(da, 0.16, 0.44))
  }
  return n
}
/** 火口緣最高的地方離湖岸多遠 */
const CREST = 0.9
/** 外坡到離湖岸多遠為止：火山越高，山腳越寬（湖變大之後坡做陡一點，不然整座小島都是山） */
const slopeEnd = (): number => CREST + Math.max(1.5, 1.0 + params.lift * 1.1)
/** 鏡頭在右前方（+x、+z），這個方向（弧度）是「正前方」 */
const TOWARD_CAMERA = Math.PI / 4
/**
 * 火口緣比湖面高多少：後面（離鏡頭遠的那一側）高、前面矮，湖才不會被前面的火口緣擋住。
 * 火山本身已經很高的時候，火口緣只留矮矮一圈；高度拉到 0（平地上的火口湖）時火口緣就是整座山，要高一點
 */
const rimPeak = (a: number): number => {
  const k = Math.min(1, params.lift / 1.2)
  const front = lerp(0.7, 0.2, k)
  const back = lerp(1.5, 0.6, k)
  return front + (back - front) * (0.5 - 0.5 * Math.cos(a - TOWARD_CAMERA))
}
/** 地面的高度：湖底與岸邊跟著湖面抬高；岸邊往外陡陡地到火口緣（內壁），再沿著外坡降回平地 */
const terrainHeight = (x: number, z: number): number => {
  const { r, a } = polar(x, z)
  const s = r - radiusAt(a)
  if (s < 0.3) return params.lift + bedOf(-s)
  const rough = 0.86 + 0.14 * Math.sin(a * 9 + 1.3) + 0.06 * Math.sin(a * 17)
  const top = params.lift + rimPeak(a) * rough * notch(a)
  let y: number
  if (s < CREST) y = lerp(params.lift, top, smooth(s, 0.3, CREST))
  else {
    const t = (s - CREST) / (slopeEnd() - CREST)
    // 上面陡、下面緩（火山的輪廓）
    y = t >= 1 ? 0 : top * (1 - t) ** 1.5
  }
  // 火山靠到小島邊緣時，山坡在邊緣前面收回平地（小島的側面是從平地往下的）
  return y * smooth(edgeDist(x, z), 0.45, 1.5)
}
/** 火山上、這個方向、離湖岸 s 的一點 */
const rimPoint = (a: number, s: number): THREE.Vector3 => {
  const c = center()
  const r = radiusAt(a) + s
  const x = c.x + Math.cos(a) * r
  const z = c.z + Math.sin(a) * r
  return new THREE.Vector3(x, terrainHeight(x, z), z)
}

// ── 兩種風格 ─────────────────────────────────────────

interface Look {
  title: string
  notes: string[]
  /** 平地的兩種深淺 */
  ground: [number, number]
  /** 火山：下半的山坡、上半與內壁的岩石 */
  slope: number
  crest: number
  /** 岸邊、淺水的湖底、深水的湖底 */
  shore: number
  bedShallow: number
  bedDeep: number
  water: number
  waterOpacity: number
  /** 小島側面 */
  cliff: number
  rock: [number, number]
  fence: number
}

const LOOKS: Record<Variant, Look> = {
  dormant: {
    title: '休火山：長了草的山坡、翠綠的湖',
    notes: ['山坡下半長草，上半和火口內壁是灰褐色的岩石。', '湖水是火山湖那種翠綠，岸邊一圈淡色的礦物沉積。', '山坡上兩三處噴氣孔冒著淡淡的白煙，旁邊有黃色的硫磺。', '平地照常有草叢和小花，零星幾顆火山岩。'],
    ground: [0x6f9c5a, 0x7ba865],
    slope: 0x7f8f62,
    crest: 0x8b8176,
    shore: 0xd9d6c4,
    bedShallow: 0x9fe0c8,
    bedDeep: 0x0f7a72,
    water: 0x35b9a4,
    waterOpacity: 0.62,
    cliff: 0x8a6a4c,
    rock: [0x77726b, 0x8a857c],
    fence: 0xb48a5c,
  },
  active: {
    title: '活火山：深色火山岩、濃煙',
    notes: ['整片地面是深色的火山岩和火山灰，沒有草。', '沒有岩漿（原本山坡上有發亮的熔岩裂縫，使用者說不要）。', '湖水是偏白的青綠色（酸性火山湖），岸邊是硫磺的黃。', '噴氣孔的煙比較濃，還有幾棵燒焦的枯樹。'],
    ground: [0x4d4844, 0x59534d],
    slope: 0x443f3c,
    crest: 0x35302e,
    shore: 0xcdb95e,
    bedShallow: 0xa9e3d3,
    bedDeep: 0x2a8f8c,
    water: 0x5fd0c2,
    waterOpacity: 0.68,
    cliff: 0x4a3f3a,
    rock: [0x3a3634, 0x4a4542],
    fence: 0x5a4a40,
  },
}

// ── 場景 ─────────────────────────────────────────────

/** 牧場本體的 RanchScene 用整個視窗的大小；這裡跟著畫布的大小 */
class DemoRanch extends RanchScene {
  override resize(): void {
    const canvas = this.renderer.domElement
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    this.renderer.setSize(w, h, false)
    this.frameIsland(w, h)
  }
}

// 🔴 只改這一頁記憶體裡的地圖表，不寫回檔案：讓 RanchScene 蓋一座沒有水、整圈都有柵欄的平地小島
MAPS['lake-center'] = { id: 'lake-center', water: () => -9, trees: [] }

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const ranch = new DemoRanch(canvas)
ranch.setMap('lake-center')
ranch.setFrame({ width: 0.9, bottom: 0.94, top: 0.05 })

/** RanchScene 把地面、水、柵欄都放在 scene 底下的一個 Group 裡 */
const world = ranch.scene.children.find((o): o is THREE.Group => (o as THREE.Group).isGroup)!
// 草地地圖的裝飾（草叢、花）和牧場本體的水面拿掉；留地面、側面、柵欄與木門
const KEEP = new Set(['PlaneGeometry', 'BoxGeometry', 'BufferGeometry'])
for (const child of [...world.children]) {
  const mesh = child as THREE.Mesh
  if (child === ranch.ground || (child as THREE.Group).isGroup) continue
  if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh || !mesh.isMesh || !KEEP.has(mesh.geometry.type)) world.remove(child)
}
const wallMesh = world.children.find((o) => (o as THREE.Mesh).geometry?.type === 'BufferGeometry') as THREE.Mesh
const fenceMeshes = world.children.filter((o) => (o as THREE.Mesh).geometry?.type === 'BoxGeometry') as THREE.Mesh[]

/** 這一頁自己加的東西（湖水、石頭、噴氣孔、樹）：換風格、拉拉桿時整組重蓋 */
const decor = new THREE.Group()
ranch.scene.add(decor)
/** 會動的煙：每一團記著從哪裡冒出來、現在飄到哪 */
let puffs: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number; scale: number }[] = []

/** 地面網格：每個頂點照火山的形狀定高度、照風格上色 */
function paintGround(look: Look): void {
  const geo = ranch.ground.geometry
  const pos = geo.attributes.position
  const colors = geo.attributes.color
  const g1 = new THREE.Color(look.ground[0])
  const g2 = new THREE.Color(look.ground[1])
  const slope = new THREE.Color(look.slope)
  const crest = new THREE.Color(look.crest)
  const shore = new THREE.Color(look.shore)
  const shallow = new THREE.Color(look.bedShallow)
  const deep = new THREE.Color(look.bedDeep)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const d = lakeDist(x, z)
    const y = terrainHeight(x, z)
    pos.setY(i, y)
    if (d > 0) {
      c.copy(shore).lerp(shallow, smooth(d, 0, 0.5))
      c.lerp(deep, smooth(d, 0.6, 2.0))
    } else if (d > -0.55) {
      c.copy(shore)
    } else {
      // 平地的顏色 → 山坡下半（草或火山灰）→ 上半與火口內壁（岩石）
      const { a } = polar(x, z)
      const top = params.lift + rimPeak(a)
      const f = top > 0 ? y / top : 0
      c.copy(g1).lerp(g2, 0.5 + 0.5 * Math.sin(x * 1.3) * Math.sin(z * 1.7))
      c.lerp(slope, smooth(y, 0.03, 0.35))
      const inner = -d < CREST ? 1 : 0
      c.lerp(crest, Math.max(smooth(f, 0.5, 0.82), inner * smooth(y - params.lift, 0.05, 0.25)))
      // 岸邊往外一小段是礦物沉積的顏色，漸漸接到內壁
      c.lerp(shore, 1 - smooth(-d, 0.55, 0.78))
    }
    colors.setXYZ(i, c.r, c.g, c.b)
  }
  pos.needsUpdate = true
  colors.needsUpdate = true
  geo.computeVertexNormals()
}

/** 山頂的湖水：照湖岸的形狀鋪一片半透明的水面 */
function buildWater(look: Look): void {
  const c = center()
  const shape = new THREE.Shape()
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2
    const r = radiusAt(a) + 0.04
    // 形狀的 y 轉成水平後是世界的 -z，所以先把 z 反過來
    if (i === 0) shape.moveTo(Math.cos(a) * r, -Math.sin(a) * r)
    else shape.lineTo(Math.cos(a) * r, -Math.sin(a) * r)
  }
  shape.closePath()
  const water = new THREE.Mesh(
    new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: look.water, transparent: true, opacity: look.waterOpacity, roughness: 0.08, metalness: 0.05, depthWrite: false }),
  )
  water.position.set(c.x, params.lift + WATER_Y, c.z)
  water.renderOrder = 1
  decor.add(water)
}

/** 一棵樹：休火山是小針葉樹，活火山是燒焦的枯樹 */
function tree(b: Batch, look: Variant, x: number, z: number, size: number): void {
  const base = new THREE.Matrix4().compose(
    new THREE.Vector3(x, terrainHeight(x, z), z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6.28)),
    new THREE.Vector3(size, size, size),
  )
  if (look === 'dormant') {
    b.put(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6), flat(0x6e4a2c, 1), base, new THREE.Vector3(0, 0.25, 0))
    const leaf = flat(0x3d7a4a, 0.9)
    ;[
      [0.45, 0.6, 0.75],
      [0.9, 0.46, 0.68],
      [1.3, 0.3, 0.6],
    ].forEach(([y, r, h]) => b.put(new THREE.ConeGeometry(r, h, 7), leaf, base, new THREE.Vector3(0, y + h / 2, 0)))
    return
  }
  const char = flat(0x2a2422, 1)
  const top = new THREE.Vector3(rand(-0.1, 0.1), 1.5, rand(-0.1, 0.1))
  b.rod(char, base, new THREE.Vector3(0, 0, 0), top, 0.09, 0.03, 6)
  for (let i = 0; i < 4; i++) {
    const y = 0.6 + i * 0.22
    const a = i * 2.3 + rand(0, 0.5)
    const from = top.clone().multiplyScalar(y / 1.5)
    b.rod(char, base, from, from.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4)), 0.03, 0.01, 4)
  }
}

/** 湖水、石頭、噴氣孔、樹 */
function buildDecor(variant: Variant, look: Look): void {
  decor.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
  })
  decor.clear()
  puffs = []
  buildWater(look)
  const b = new Batch()
  const id = new THREE.Matrix4()
  const rocks = [flat(look.rock[0], 1), flat(look.rock[1], 1)]
  const end = slopeEnd()

  // 火口緣上的石頭：沿著稜線一圈，缺口的地方不放
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rand(-0.04, 0.04)
    if (notch(a) < 0.75) continue
    const p = rimPoint(a, CREST + rand(-0.15, 0.25))
    const r = rand(0.14, 0.32)
    b.put(new THREE.DodecahedronGeometry(r, 0), rocks[i % 2], id, p.add(new THREE.Vector3(0, r * 0.25, 0)), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, rand(0.6, 0.9), 1))
  }
  // 缺口兩側各一塊大石頭，像門柱
  for (const c of NOTCHES) {
    for (const side of [-0.5, 0.5]) {
      const p = rimPoint(c + side, 0.8)
      b.put(new THREE.DodecahedronGeometry(0.4, 0), rocks[0], id, p.add(new THREE.Vector3(0, 0.12, 0)), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.8, 1))
    }
  }
  // 山坡上滾下來的石頭、平地上零星的火山岩
  for (let i = 0; i < 14; i++) {
    const p = rimPoint(rand(0, Math.PI * 2), rand(CREST + 0.6, end + 0.6))
    if (edgeDist(p.x, p.z) < 0.9) continue
    const s = rand(0.16, 0.36)
    b.put(new THREE.DodecahedronGeometry(s, 0), rocks[i % 2], id, p.add(new THREE.Vector3(0, s * 0.25, 0)), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
  }
  ;[
    [6.4, 4.4, 0.4],
    [6.6, -2.6, 0.32],
    [1.8, 6.8, 0.3],
    [-5.6, 6.6, 0.36],
  ].forEach(([x, z, s], i) => {
    const y = terrainHeight(x, z)
    b.put(new THREE.DodecahedronGeometry(s, 0), rocks[i % 2], id, new THREE.Vector3(x, y + s * 0.3, z), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
    b.put(new THREE.DodecahedronGeometry(s * 0.5, 0), rocks[(i + 1) % 2], id, new THREE.Vector3(x + s * 1.1, y + s * 0.15, z + s * 0.4), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
  })

  // 噴氣孔：外坡上一小圈深色的石頭、一片硫磺黃，上面冒煙（挑朝前、看得到的那幾個方向）
  const sulfur = flat(0xd8c64a, 1)
  const vents = variant === 'active' ? [0.2, 1.5, 2.2, 5.4, 6.0] : [0.2, 1.6, 5.6]
  for (const a of vents) {
    const p = rimPoint(a, CREST + 0.7)
    b.put(new THREE.CylinderGeometry(0.3, 0.36, 0.03, 9), sulfur, id, p.clone().add(new THREE.Vector3(0, 0.04, 0)))
    b.put(new THREE.ConeGeometry(0.18, 0.16, 7), rocks[0], id, p.clone().add(new THREE.Vector3(0, 0.1, 0)))
    const count = variant === 'active' ? 5 : 3
    for (let k = 0; k < count; k++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: variant === 'active' ? 0xbfb8b2 : 0xf4f6f7, roughness: 1, flatShading: true, transparent: true, opacity: 0.8, depthWrite: false }),
      )
      decor.add(mesh)
      puffs.push({ mesh, base: p.clone().add(new THREE.Vector3(0, 0.2, 0)), phase: k / count + rand(0, 0.1), scale: variant === 'active' ? 1.35 : 1 })
    }
  }

  // 樹：種在前面的平地（火山靠後面時，前面空出來的地方）
  const trees: [number, number, number][] = [
    [6.9, -4.6, 1.0],
    [-4.8, 6.9, 0.9],
    [6.6, 6.2, 0.85],
  ]
  for (const [x, z, size] of trees) tree(b, variant, x, z, size)

  if (variant === 'dormant') {
    // 平地與山坡下半零星的草叢和小花（很小）
    const tuft = flat(0x5b8a4b, 1)
    const petals = [0xffffff, 0xffe066, 0xff9bb5].map((col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }))
    for (let i = 0, placed = 0; i < 5000 && placed < 340; i++) {
      const x = rand(-7.6, 7.6)
      const z = rand(-7.6, 7.6)
      const y = terrainHeight(x, z)
      if (lakeDist(x, z) > -1.0 || y > 0.6 || edgeDist(x, z) < 0.5) continue
      if (placed % 4 === 0) b.put(new THREE.SphereGeometry(0.045, 6, 5), petals[placed % 3], id, new THREE.Vector3(x, y + 0.13, z))
      else b.put(new THREE.ConeGeometry(0.05, 0.16, 4), tuft, id, new THREE.Vector3(x, y + 0.07, z))
      placed++
    }
  }
  b.build(decor)
}

let current: Variant = 'active'

function apply(): void {
  const look = LOOKS[current]
  document.body.dataset.variant = current
  for (const button of document.querySelectorAll<HTMLButtonElement>('.variants button')) button.setAttribute('aria-pressed', String(button.dataset.variant === current))
  document.querySelector('#look-title')!.textContent = look.title
  document.querySelector('#look-notes')!.replaceChildren(
    ...look.notes.map((text) => {
      const li = document.createElement('li')
      li.textContent = text
      return li
    }),
  )
  document.querySelector('#size-value')!.textContent = params.size.toFixed(1)
  document.querySelector('#lift-value')!.textContent = params.lift.toFixed(1)
  // 湖太大、移不了那麼遠時，顯示實際移了多少
  document.querySelector('#back-value')!.textContent = backShift().toFixed(1)
  paintGround(look)
  ;(wallMesh.material as THREE.MeshStandardMaterial).color.setHex(look.cliff)
  for (const mesh of fenceMeshes) (mesh.material as THREE.MeshStandardMaterial).color.setHex(look.fence)
  // 木門（一個 Group）也跟著柵欄的顏色
  for (const child of world.children) {
    if (!(child as THREE.Group).isGroup) continue
    child.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) (mesh.material as THREE.MeshStandardMaterial).color.setHex(look.fence)
    })
  }
  buildDecor(current, look)
  render()
}

/** 煙：每一團從噴氣孔往上飄、變大、變淡，飄到頂再從頭來 */
function animate(time: number): void {
  for (const p of puffs) {
    const t = (time * 0.00012 + p.phase) % 1
    p.mesh.position.set(p.base.x + t * 0.35, p.base.y + t * 1.7 * p.scale, p.base.z - t * 0.2)
    p.mesh.scale.setScalar((0.1 + t * 0.34) * p.scale)
    ;(p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.78 * (1 - t) ** 1.4
  }
}

function render(): void {
  animate(performance.now())
  ranch.render()
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.variants button')) {
  button.addEventListener('click', () => {
    current = button.dataset.variant as Variant
    apply()
  })
}
const sizeInput = document.querySelector<HTMLInputElement>('#size')!
sizeInput.addEventListener('input', () => {
  params.size = Number(sizeInput.value)
  apply()
})
const liftInput = document.querySelector<HTMLInputElement>('#lift')!
const backInput = document.querySelector<HTMLInputElement>('#back')!
liftInput.addEventListener('input', () => {
  params.lift = Number(liftInput.value)
  apply()
})
backInput.addEventListener('input', () => {
  params.back = Number(backInput.value)
  apply()
})
new ResizeObserver(() => {
  ranch.resize()
  render()
}).observe(canvas)

// 網址可以帶起始值：?look=dormant&size=4&lift=2&back=1
const query = new URLSearchParams(location.search)
if (query.get('look') === 'dormant') current = 'dormant'
for (const [key, input] of [
  ['size', sizeInput],
  ['lift', liftInput],
  ['back', backInput],
] as const) {
  const value = Number(query.get(key))
  if (query.has(key) && Number.isFinite(value)) input.value = String(value)
  params[key] = Number(input.value)
}
apply()
requestAnimationFrame(function loop() {
  render()
  requestAnimationFrame(loop)
})
