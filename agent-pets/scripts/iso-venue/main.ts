/**
 * 等角場地預覽（2026-11-12 使用者的草圖）：只有場地、沒有寵物。網址 ?v=1 ～ ?v=4 切換版本（預設 4）。
 *
 * - 版本 1：兩塊圓角方形地斜斜相接。左下大部分是湖（靠接縫的地方留一片陸地，湖岸彎進來），右上草地，最上面的角一座灰色石頭山。
 * - 版本 2：兩塊菱形左右並排、中間重疊。右邊那塊是湖，湖在右下那條邊沒有沙灘擋著，水從邊緣流出去變成瀑布，往下掉出場地。
 * - 版本 3：一塊大菱形，中央偏上一座湖；牧場放大、往下擺，最下面那個角被畫面底邊切掉。
 * - 版本 4：同版本 3 的菱形，但整座放進畫面（不切），擺在畫面中間偏下，上方留給泡泡。
 *   湖形用 &lake= 切換：center 中央湖、left 左側湖、river 中央河（切斷土地，右下流出去變瀑布）、
 *   river2 中央河 2（從左角到右角水平切過陸地）、half 半月湖（水佔右半邊、從上角到下角的彎月）、bottom 下方湖（地水各半）。
 *
 * 鏡頭跟另一個 session 做的等角視角一樣（src/iso-view.ts）：正交鏡頭在右前方，水平轉 45°、往下看 30°。
 * 地面做法跟牧場本體一樣：高度網格（草地 y = 0，水的地方往下挖）＋半透明水面＋泥土側面。
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// ── 共用的尺寸與工具 ─────────────────────────────────

/** 每塊地的邊長（版本 3 比較大，由版本設定改掉）、圓角 */
let S = 12
const CORNER = 1.6
const WATER_Y = -0.05
const BEACH = 0.55
const SHELF = 0.7
const SHELF_Y = -0.42
const DEEP = -0.72
/** 湖離外緣多遠開始是沙灘；離另一塊地至少多遠（接縫處留陸地） */
const RIM = 0.6
const GAP = 1.4

/** 點到某塊地（圓角方形）外緣的距離，裡面是正的 */
function edge(t: THREE.Vector2, x: number, z: number, inset = 0): number {
  const h = S / 2 - inset
  const r = Math.max(CORNER - inset, 0.01)
  const qx = Math.abs(x - t.x) - (h - r)
  const qz = Math.abs(z - t.y) - (h - r)
  return -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r)
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** 離岸距離 → 湖底高度（陸地是 0） */
function bedOf(d: number): number {
  if (d <= -BEACH) return 0
  if (d <= 0) return WATER_Y * smooth((d + BEACH) / BEACH)
  if (d <= SHELF) return WATER_Y + (SHELF_Y - WATER_Y) * (d / SHELF)
  return SHELF_Y + (DEEP - SHELF_Y) * smooth((d - SHELF) / 0.8)
}

/** 某塊地的外緣往內縮 inset 的點（x, y＝世界的 x, z） */
function outline(t: THREE.Vector2, inset: number, n: number): THREE.Vector2[] {
  const h = S / 2 - inset
  const r = Math.max(CORNER - inset, 0.01)
  const s = new THREE.Shape()
  s.moveTo(-h + r, -h)
  s.lineTo(h - r, -h)
  s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false)
  s.lineTo(h, h - r)
  s.absarc(h - r, h - r, r, 0, Math.PI / 2, false)
  s.lineTo(-h + r, h)
  s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-h, -h + r)
  s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false)
  return s.getSpacedPoints(n).map((p) => new THREE.Vector2(p.x + t.x, p.y + t.y))
}

let seed = 11
function rand(): number {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

// ── 版本 ─────────────────────────────────────────────

interface Waterfall {
  /** 瀑布在湖那塊地的 +x 邊（等角畫面上的右下邊），z 範圍 */
  x: number
  z0: number
  z1: number
}

interface Layout {
  key: string
  title: string
  note: string
  /** 每塊地的邊長 */
  size: number
  /** 所有的地（中心點）；lake 是有湖的那塊、land 是放樹的那塊（只有一塊地時兩個一樣） */
  tiles: THREE.Vector2[]
  lake: THREE.Vector2
  land: THREE.Vector2
  /** 水域距離：> 0 在水裡（離岸多遠） */
  water: (x: number, z: number) => number
  mountain: THREE.Vector2 | null
  waterfall: Waterfall | null
  /** 樹（相對 land 那塊地中心，以邊長為單位） */
  trees: [number, number, number][]
  /** 水面要不要一路到外緣（有瀑布的那塊要） */
  waterInset: number
  /** 取景：最低的地方（最下面那個角）超出畫面底邊多少（畫面高度的比例）；沒有就整座放進畫面 */
  cutBottom?: number
  /** 取景：左右佔畫面寬度的比例 */
  width?: number
  /** 取景：上方留給泡泡的比例 */
  top?: number
}

function layout1(): Layout {
  const A = new THREE.Vector2(-0.06 * S, 0.425 * S)
  const B = new THREE.Vector2(0.06 * S, -0.425 * S)
  const notch = { x: A.x + 0.12 * S, z: A.y - 0.5 * S, r: 0.4 * S }
  return {
    key: '1',
    title: '版本 1',
    note: '左下：湖（接縫處留陸地）／右上：草地＋石頭山',
    size: 12,
    tiles: [A, B],
    lake: A,
    land: B,
    water: (x, z) => Math.min(edge(A, x, z) - RIM, -edge(B, x, z) - GAP, Math.hypot(x - notch.x, z - notch.z) - notch.r),
    mountain: new THREE.Vector2(B.x - 0.5 * S + 3.2, B.y - 0.5 * S + 3.0),
    waterfall: null,
    trees: [
      [0.38, -0.3, 1.1],
      [0.4, 0.3, 0.85],
      [-0.05, 0.38, 0.9],
      [0.12, -0.05, 0.75],
    ],
    waterInset: 0.2,
  }
}

/** 版本 2：右邊那塊往右（+x、-z 各 0.6 邊長）錯開，中間重疊一塊 */
function layout2(): Layout {
  const A = new THREE.Vector2(-0.3 * S, 0.3 * S)
  const B = new THREE.Vector2(0.3 * S, -0.3 * S)
  const fall: Waterfall = { x: B.x + S / 2, z0: B.y - 3.4, z1: B.y + 3.4 }
  return {
    key: '2',
    title: '版本 2',
    note: '左：草地／右：湖，從右下那條邊流出去變成瀑布',
    size: 12,
    tiles: [A, B],
    lake: B,
    land: A,
    water: (x, z) => {
      // 一般的湖（外緣留沙灘、離左邊那塊地 GAP）
      const lake = edge(B, x, z) - RIM
      // 往瀑布的水道：瀑布寬度內，一路通到 +x 外緣（那裡沒有沙灘）
      const channel = Math.min((fall.z1 - fall.z0) / 2 - Math.abs(z - B.y), x - B.x)
      return Math.min(Math.max(lake, channel), -edge(A, x, z) - GAP)
    },
    mountain: null,
    waterfall: fall,
    trees: [
      [-0.3, -0.28, 1.1],
      [-0.36, 0.2, 0.9],
      [0.05, 0.38, 0.85],
      [-0.08, -0.05, 0.75],
      [0.32, 0.3, 0.8],
    ],
    waterInset: 0.01,
  }
}

/** 版本 3：一塊大菱形（邊長 16），湖在中央偏上；最下面那個角被畫面切掉 */
function layout3(): Layout {
  S = 16
  const C = new THREE.Vector2(0, 0)
  // 湖心往 -x、-z 偏一點（等角畫面上是往上）
  const lake = new THREE.Vector2(-1.2, -1.1)
  return {
    key: '3',
    title: '版本 3',
    note: '一塊大菱形、中央湖；最下面的角被畫面切掉',
    size: 16,
    tiles: [C],
    lake: C,
    land: C,
    water: (x, z) => {
      const dx = x - lake.x
      const dz = z - lake.y
      const a = Math.atan2(dz, dx)
      const rx = 3.9 * (1 + 0.06 * Math.sin(3 * a + 0.5))
      const rz = 3.4 * (1 + 0.07 * Math.sin(2 * a + 1.2))
      return Math.min((1 - Math.hypot(dx / rx, dz / rz)) * 3.4, edge(C, x, z) - RIM)
    },
    mountain: null,
    waterfall: null,
    trees: [
      [-0.37, -0.37, 1.15],
      [-0.4, 0.28, 0.9],
      [0.28, -0.4, 0.95],
      [0.2, 0.08, 0.8],
      [-0.08, 0.32, 0.85],
      [0.36, -0.1, 0.75],
      [-0.2, -0.42, 0.8],
    ],
    waterInset: 0.2,
    cutBottom: 0.12,
    width: 0.94,
  }
}

/** 版本 4 的湖形 */
const LAKE_SHAPES: { id: string; label: string; note: string }[] = [
  { id: 'center', label: '中央湖', note: '菱形中央湖（正常款）：整座放進畫面、位置在中下' },
  { id: 'left', label: '左側湖', note: '左側湖：菱形左半邊是湖' },
  { id: 'river', label: '中央河', note: '中央河：從左上流到右下、把陸地切成兩半，右下流出去變瀑布' },
  { id: 'river2', label: '中央河 2', note: '中央河 2：從左角到右角水平切過陸地，分成上下兩塊' },
  { id: 'half', label: '半月湖', note: '半月湖：水佔右半邊、從上角到下角，左邊的岸往右鼓，水是彎月形' },
  { id: 'bottom', label: '下方湖', note: '下方湖：下半部是水、上半部是陸地，各一半' },
]

/** 版本 4：跟版本 3 一樣的菱形，整座放進畫面、擺在中間偏下（上方留 28% 給泡泡，跟桌布模式一樣）；湖形可以換 */
function layout4(shape: string): Layout {
  const base = layout3()
  const C = base.lake
  const h = S / 2
  // 等角畫面上的座標：u 往右、w 往下（往鏡頭）；菱形左角 u = -h√2、右角 u = +h√2、上角 w = -h√2、下角 w = +h√2
  const U = (x: number, z: number) => (x - z) / Math.SQRT2
  const W = (x: number, z: number) => (x + z) / Math.SQRT2
  const info = LAKE_SHAPES.find((l) => l.id === shape) ?? LAKE_SHAPES[0]
  let water = base.water
  let waterfall: Waterfall | null = null
  let waterInset = base.waterInset
  if (shape === 'center') {
    // 版本 3 的中央湖再大一點（約 1.4 倍）
    const lake = new THREE.Vector2(C.x - 1.2, C.y - 1.1)
    water = (x, z) => {
      const dx = x - lake.x
      const dz = z - lake.y
      const a = Math.atan2(dz, dx)
      const rx = 5.4 * (1 + 0.06 * Math.sin(3 * a + 0.5))
      const rz = 4.7 * (1 + 0.07 * Math.sin(2 * a + 1.2))
      return Math.min((1 - Math.hypot(dx / rx, dz / rz)) * 4.7, edge(C, x, z) - RIM)
    }
  } else if (shape === 'left') {
    // 左角那一帶：岸線大約在 u = -2.2，微微彎
    water = (x, z) => Math.min(-2.2 + 0.6 * Math.sin(W(x, z) * 0.7) - U(x, z), edge(C, x, z) - RIM)
  } else if (shape === 'half') {
    // 2026-11-12 使用者草圖：水佔右半邊、從上角一路到下角；左邊陸地的岸線往右鼓出去，
    // 所以水在右角最厚、往上下兩角變細，整片水是一個彎月。岸線：u = -0.6 + 2.4 × (1 − (w / 對角半長)²)
    const reach = h * Math.SQRT2
    const shore = (w: number) => -0.6 + 2.4 * (1 - (w / reach) ** 2)
    water = (x, z) => Math.min(U(x, z) - shore(W(x, z)), edge(C, x, z) - RIM)
  } else if (shape === 'bottom') {
    // 下半部（w > 0）是水，岸線微微彎
    water = (x, z) => Math.min(W(x, z) - (0.2 + 0.6 * Math.sin(U(x, z) * 0.5)), edge(C, x, z) - RIM)
  } else if (shape === 'river2') {
    // 沿 u（畫面上的水平方向）從左角到右角，稍微偏上（w < 0）。
    // 兩頭在小島邊緣留一圈沙灘（2026-11-12：原本直接切穿邊緣，左右兩角的泥土側面跟著凹下去、露出斷面，使用者說壞了）
    const half = 1.5
    const mid = (u: number) => -2.0 + 0.5 * Math.sin(u * 0.45)
    water = (x, z) => Math.min(half - Math.abs(W(x, z) - mid(U(x, z))), edge(C, x, z) - RIM)
  } else if (shape === 'river') {
    // 沿 x 方向（等角畫面上從左上邊到右下邊）一條彎彎的河，兩頭都到外緣：左上那頭在背面看不到，右下那頭流出去變瀑布
    const half = 1.6
    const mid = (x: number) => C.y + 0.9 * Math.sin((x - C.x) * 0.38)
    water = (x, z) => Math.min(half - Math.abs(z - mid(x)), h - Math.abs(z - C.y) - RIM)
    const end = mid(C.x + h)
    waterfall = { x: C.x + h, z0: end - half + 0.2, z1: end + half - 0.2 }
    waterInset = 0.01
  }
  return {
    ...base,
    key: '4',
    title: `版本 4・${info.label}`,
    note: info.note,
    water,
    waterfall,
    waterInset,
    // 樹的候選位置很多，落在水裡的會被濾掉，最多留 7 棵
    trees: [
      [-0.37, -0.37, 1.15],
      [-0.4, 0.3, 0.9],
      [0.3, -0.4, 0.95],
      [0.38, 0.38, 0.85],
      [0.2, 0.08, 0.8],
      [-0.08, 0.32, 0.85],
      [0.36, -0.1, 0.75],
      [-0.2, -0.42, 0.8],
      [-0.3, -0.05, 0.85],
      [0.05, -0.25, 0.8],
      [0.1, 0.4, 0.75],
    ],
    cutBottom: undefined,
    top: 0.28,
  }
}

const PARAMS = new URLSearchParams(location.search)
const VERSION = PARAMS.get('v') ?? '4'
const LAKE_SHAPE = PARAMS.get('lake') ?? 'center'
const L = VERSION === '1' ? layout1() : VERSION === '2' ? layout2() : VERSION === '3' ? layout3() : layout4(LAKE_SHAPE)
S = L.size
const water = L.water
/** 瀑布口：湖底在靠外緣 LIP_RUN 內慢慢墊高到 LIP_Y（剛好在水面下），水從這裡溢出去 */
const LIP_Y = WATER_Y - 0.1
const LIP_RUN = 1.8

/** 地面高度：湖底、沙灘、草地；瀑布口墊高 */
function groundAt(x: number, z: number): number {
  let y = bedOf(water(x, z))
  const f = L.waterfall
  if (f && y < LIP_Y && z > f.z0 - 0.8 && z < f.z1 + 0.8) {
    const t = smooth((x - (f.x - LIP_RUN)) / LIP_RUN)
    y += (LIP_Y - y) * t
  }
  return y
}

function onLand(x: number, z: number, margin = 0): boolean {
  return Math.max(...L.tiles.map((t) => edge(t, x, z))) > 0.3 + margin && water(x, z) < -0.75 - margin
}

// ── three.js ─────────────────────────────────────────

document.querySelector('#title')!.textContent = `等角場地預覽・${L.title}`
document.querySelector('#note')!.textContent = L.note

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55
scene.add(new THREE.HemisphereLight(0xfff6e5, 0x6b8f4e, 1.4))
const sun = new THREE.DirectionalLight(0xffffff, 1.6)
sun.position.set(-6, 13, 8)
scene.add(sun)

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
/** 水平轉角（右前方 45°），按「轉 90°」每次加 90° */
let yaw = Math.PI / 4
const PITCH = THREE.MathUtils.degToRad(30)

function buildTile(t: THREE.Vector2): void {
  const geo = new THREE.PlaneGeometry(S, S, S * 22, S * 22)
  geo.rotateX(-Math.PI / 2)
  geo.translate(t.x, 0, t.y)
  const pos = geo.attributes.position
  const colors: number[] = []
  const grass = new THREE.Color(0x6fb04a)
  const grass2 = new THREE.Color(0x7cbc52)
  const sandDry = new THREE.Color(0xeadcae)
  const sandWet = new THREE.Color(0xd5c08a)
  const moss = new THREE.Color(0x7d9a6c)
  const deep = new THREE.Color(0x3f7480)
  const rockLip = new THREE.Color(0x8f9a94)
  const c = new THREE.Color()
  const h = S / 2
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i)
    let z = pos.getZ(i)
    // 圓角外面的頂點拉回圓角上
    const qx = Math.abs(x - t.x) - (h - CORNER)
    const qz = Math.abs(z - t.y) - (h - CORNER)
    if (qx > 0 && qz > 0) {
      const len = Math.hypot(qx, qz)
      if (len > CORNER) {
        x = t.x + Math.sign(x - t.x) * (h - CORNER + (qx / len) * CORNER)
        z = t.y + Math.sign(z - t.y) * (h - CORNER + (qz / len) * CORNER)
      }
    }
    const d = water(x, z)
    const y = groundAt(x, z)
    pos.setXYZ(i, x, y, z)
    if (d < -BEACH - 0.2) c.copy(grass).lerp(grass2, 0.5 + 0.5 * Math.sin(x * 1.3) * Math.sin(z * 1.7))
    else if (d < -BEACH) c.copy(grass).lerp(sandDry, smooth((d + BEACH + 0.2) / 0.2))
    else if (d < 0) c.copy(sandDry).lerp(sandWet, smooth((d + 0.3) / 0.3))
    else if (d < 0.7) c.copy(sandWet).lerp(moss, d / 0.7)
    else c.copy(moss).lerp(deep, smooth((d - 0.7) / 0.8))
    // 瀑布口墊高的地方是石頭色
    if (L.waterfall && d > 0 && y > bedOf(d) + 0.05) c.lerp(rockLip, smooth((y - bedOf(d)) / 0.4))
    colors.push(c.r, c.g, c.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })))

  // 泥土側面：上緣跟著地面高度（瀑布口那段比較低）；在另一塊地底下的那段會被那塊地的地面蓋住
  const ring = outline(t, 0, 320)
  const layers: [number, number][] = [
    [0, 0],
    [-0.08, 0.08],
    [-0.16, 0.12],
    [-0.9, 0.12],
    [-0.98, 0.04],
  ]
  const normals = ring.map((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]
    const b = ring[(i + 1) % ring.length]
    const tg = b.clone().sub(a).normalize()
    const n = new THREE.Vector2(tg.y, -tg.x)
    if (n.dot(p.clone().sub(t)) < 0) n.negate()
    return n
  })
  const tops = ring.map((p) => Math.min(0, groundAt(p.x, p.y)))
  const wallPos: number[] = []
  for (const [y, out] of layers) ring.forEach((p, i) => wallPos.push(p.x + normals[i].x * out, Math.min(y, tops[i] + y), p.y + normals[i].y * out))
  const idx: number[] = []
  const n = ring.length
  for (let l = 0; l < layers.length - 1; l++) {
    for (let i = 0; i < n; i++) {
      const a = l * n + i
      const b = l * n + ((i + 1) % n)
      idx.push(a, b, a + n, b, b + n, a + n)
    }
  }
  const wall = new THREE.BufferGeometry()
  wall.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3))
  wall.setIndex(idx)
  wall.computeVertexNormals()
  scene.add(new THREE.Mesh(wall, new THREE.MeshStandardMaterial({ color: 0x9a6b43, roughness: 1, side: THREE.DoubleSide })))
}

function inLakeTile(): [number, number] {
  return [L.lake.x + (rand() - 0.5) * S, L.lake.y + (rand() - 0.5) * S]
}

function buildWater(): void {
  // 形狀的 y 轉成水平後是世界的 -z，所以先把 z 反過來
  const shape = new THREE.Shape(outline(L.lake, L.waterInset, 240).map((p) => new THREE.Vector2(p.x, -p.y)))
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4fb2e3, transparent: true, opacity: 0.6, roughness: 0.08, metalness: 0.05, depthWrite: false }),
  )
  mesh.position.y = WATER_Y
  mesh.renderOrder = 1
  scene.add(mesh)

  // 睡蓮葉（瀑布口附近不放）
  const padMat = new THREE.MeshStandardMaterial({ color: 0x5fa845, roughness: 0.8, side: THREE.DoubleSide })
  let pads = 0
  for (let i = 0; i < 800 && pads < 9; i++) {
    const [x, z] = inLakeTile()
    const d = water(x, z)
    if (d < 0.25 || d > 0.8 || (L.waterfall && x > L.waterfall.x - LIP_RUN - 1)) continue
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.15 + rand() * 0.1, 20, 0.35, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2), padMat)
    pad.position.set(x, WATER_Y + 0.006, z)
    pad.rotation.y = rand() * 6
    pad.renderOrder = 2
    scene.add(pad)
    pads++
  }
  // 岸邊的小石頭、蘆葦
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xa9a294, roughness: 1, flatShading: true })
  let rocks = 0
  for (let i = 0; i < 800 && rocks < 8; i++) {
    const [x, z] = inLakeTile()
    const d = water(x, z)
    if (d > -0.12 || d < -0.4 || edge(L.lake, x, z) < 0.3) continue
    const r = 0.08 + rand() * 0.09
    const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat)
    rk.position.set(x, groundAt(x, z) + r * 0.3, z)
    rk.scale.y = 0.6
    scene.add(rk)
    rocks++
  }
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b9a3e, roughness: 1 })
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 })
  let reeds = 0
  for (let i = 0; i < 800 && reeds < 4; i++) {
    const [x, z] = inLakeTile()
    const d = water(x, z)
    if (d > 0.08 || d < -0.15 || edge(L.lake, x, z) < 0.5) continue
    for (let j = 0; j < 3; j++) {
      const sx = x + (rand() - 0.5) * 0.25
      const sz = z + (rand() - 0.5) * 0.25
      const hgt = 0.4 + rand() * 0.2
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, hgt, 4), stemMat)
      stem.position.set(sx, groundAt(sx, sz) + hgt / 2, sz)
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.09, 2, 6), headMat)
      head.position.set(sx, groundAt(sx, sz) + hgt, sz)
      scene.add(stem, head)
    }
    reeds++
  }
}

/** 低多邊形石頭：二十面體細分後把頂點隨機推一推，平面著色 */
function rock(scale: THREE.Vector3, color: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, 1)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  const moved = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    // 同一個位置的頂點要推一樣多，不然面會裂開
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    let k = moved.get(key)
    if (k === undefined) {
      k = 0.82 + rand() * 0.36
      moved.set(key, k)
    }
    v.multiplyScalar(k)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }))
  mesh.scale.copy(scale)
  return mesh
}

function buildMountain(at: THREE.Vector2): void {
  const parts: [number, number, number, number, number, number][] = [
    // dx, dz, 寬, 高, 深, 顏色
    [0, 0, 3.2, 2.4, 2.6, 0xa7a7a7],
    [-1.6, 1.1, 2.0, 1.5, 1.8, 0xb4b4b4],
    [1.9, -0.6, 2.1, 1.7, 1.9, 0x9c9c9c],
    [0.8, 1.6, 1.4, 0.9, 1.2, 0xbdbdbd],
    [-2.6, -0.8, 1.2, 0.8, 1.1, 0xa0a0a0],
  ]
  for (const [dx, dz, sx, sy, sz, color] of parts) {
    const m = rock(new THREE.Vector3(sx, sy, sz), color)
    // 下半截埋在地裡
    m.position.set(at.x + dx, -sy * 0.25, at.y + dz)
    m.rotation.y = rand() * Math.PI
    scene.add(m)
  }
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const d = 3.2 + rand() * 1.2
    const px = at.x + Math.cos(a) * d
    const pz = at.y + Math.sin(a) * d * 0.8
    if (!onLand(px, pz)) continue
    const s = 0.2 + rand() * 0.25
    const m = rock(new THREE.Vector3(s * 1.2, s * 0.8, s), 0xaaaaaa)
    m.position.set(px, s * 0.2, pz)
    scene.add(m)
  }
}

function nearMountain(x: number, z: number, margin = 0): boolean {
  const m = L.mountain
  return m !== null && Math.hypot((x - m.x) / 1.15, z - m.y) < 3.6 + margin
}

// ── 瀑布 ─────────────────────────────────────────────

/** 一條條直的水紋（白、淡藍，透明度不一），上下可以無縫重複 */
function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(150, 210, 245, 0.72)'
  g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < 70; i++) {
    const x = rand() * c.width
    const y = rand() * c.height
    const len = 40 + rand() * 140
    const w = 1 + rand() * 3
    g.fillStyle = rand() < 0.6 ? `rgba(255,255,255,${0.35 + rand() * 0.5})` : `rgba(120,190,230,${0.3 + rand() * 0.4})`
    // 畫兩次（上下各一）讓紋路可以無縫重複
    for (const oy of [0, -c.height]) g.fillRect(x, y + oy, w, len)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function softDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

interface FallFx {
  sheet: THREE.Texture
  foam: THREE.Texture
  foamMat: THREE.MeshBasicMaterial
  mist: { sprite: THREE.Sprite; phase: number; base: THREE.Vector3; size: number }[]
}

/** 瀑布往下掉多深（離開場地後慢慢淡掉） */
const FALL_DROP = 2.6
const FALL_OUT = 0.9

function buildWaterfall(f: Waterfall): FallFx {
  // 水簾：水平流出去之後往下掉（拋物線），越下面越透明，兩邊也淡一點
  const NZ = 48
  const NT = 32
  const pos: number[] = []
  const col: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= NT; j++) {
    const t = j / NT
    const x = f.x + 0.02 + FALL_OUT * t
    const y = LIP_Y + 0.08 - FALL_DROP * t * t
    for (let i = 0; i <= NZ; i++) {
      const u = i / NZ
      const z = f.z0 + (f.z1 - f.z0) * u
      pos.push(x, y, z)
      const side = smooth(Math.min(u, 1 - u) / 0.12)
      const fade = 1 - smooth((t - 0.55) / 0.45)
      col.push(1, 1, 1, side * fade)
      uv.push(u * 5, t * 1.6)
    }
  }
  for (let j = 0; j < NT; j++) {
    for (let i = 0; i < NZ; i++) {
      const a = j * (NZ + 1) + i
      idx.push(a, a + 1, a + NZ + 1, a + 1, a + NZ + 2, a + NZ + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  const sheet = streakTexture()
  const fall = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: sheet, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  )
  fall.renderOrder = 3
  scene.add(fall)

  // 瀑布口的白色水沫：水面上一條，紋路往外流
  const foam = streakTexture()
  foam.rotation = Math.PI / 2
  foam.center.set(0.5, 0.5)
  const foamMat = new THREE.MeshBasicMaterial({ map: foam, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
  const foamStrip = new THREE.Mesh(new THREE.PlaneGeometry(0.9, f.z1 - f.z0 - 0.4).rotateX(-Math.PI / 2), foamMat)
  foamStrip.position.set(f.x - 0.45, WATER_Y + 0.006, (f.z0 + f.z1) / 2)
  foamStrip.renderOrder = 2
  scene.add(foamStrip)

  // 瀑布兩旁的大石頭
  for (const z of [f.z0 - 0.55, f.z1 + 0.55]) {
    const m = rock(new THREE.Vector3(0.75, 0.6, 0.7), 0x9fa3a0)
    m.position.set(f.x - 0.45, 0.1, z)
    scene.add(m)
    const s = rock(new THREE.Vector3(0.4, 0.32, 0.38), 0xb0b4b1)
    s.position.set(f.x - 1.1, 0.02, z + (z < f.z0 ? -0.35 : 0.35))
    scene.add(s)
  }

  // 底下的水霧：幾團白霧在瀑布下半段，慢慢鼓起、淡掉
  const dot = softDot()
  const mist: FallFx['mist'] = []
  for (let i = 0; i < 18; i++) {
    const t = 0.55 + rand() * 0.35
    const base = new THREE.Vector3(f.x + FALL_OUT * t + 0.2, LIP_Y - FALL_DROP * t * t, f.z0 + 0.4 + rand() * (f.z1 - f.z0 - 0.8))
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0.4 }))
    sprite.renderOrder = 4
    scene.add(sprite)
    mist.push({ sprite, phase: rand() * Math.PI * 2, base, size: 0.7 + rand() * 0.7 })
  }
  return { sheet, foam, foamMat, mist }
}

function buildTree(x: number, z: number, size: number): void {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09 * size, 0.13 * size, 0.9 * size, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 }),
  )
  trunk.position.set(x, 0.45 * size, z)
  scene.add(trunk)
  const leaves = new THREE.MeshStandardMaterial({ color: 0x4f9a3a, roughness: 0.9, flatShading: true })
  for (const [dx, dy, dz, r] of [
    [0, 1.15, 0, 0.55],
    [-0.28, 0.95, 0.12, 0.38],
    [0.3, 1.0, -0.05, 0.4],
  ]) {
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r * size, 1), leaves)
    ball.position.set(x + dx * size, dy * size, z + dz * size)
    scene.add(ball)
  }
}

function buildFence(): void {
  const wood = new THREE.MeshStandardMaterial({ color: 0xc89a63, roughness: 0.9 })
  const postGeo = new THREE.BoxGeometry(0.1, 0.42, 0.1)
  for (const t of L.tiles) {
    const others = L.tiles.filter((o) => o !== t)
    const pts = outline(t, 0.35, Math.round((4 * S) / 0.36))
    // 只圍所有地合起來的外圈（在另一塊地裡的不要）、靠水的那段不圍、離石頭山太近的不圍
    const keep = pts.map(
      (p) => others.every((o) => edge(o, p.x, p.y) < -0.3) && water(p.x, p.y) < -0.9 && !nearMountain(p.x, p.y, 0.3),
    )
    pts.forEach((p, i) => {
      if (!keep[i]) return
      const post = new THREE.Mesh(postGeo, wood)
      post.position.set(p.x, 0.21, p.y)
      scene.add(post)
      const j = (i + 1) % pts.length
      if (!keep[j]) return
      const q = pts[j]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      for (const y of [0.16, 0.32]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.04), wood)
        rail.position.set((p.x + q.x) / 2, y, (p.y + q.y) / 2)
        rail.rotation.y = -Math.atan2(q.y - p.y, q.x - p.x)
        scene.add(rail)
      }
    })
  }
}

function buildGreenery(trees: [number, number, number][]): void {
  const tuft = new THREE.ConeGeometry(0.05, 0.16, 4)
  const tufts = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ color: 0x5f9e3c, roughness: 1, flatShading: true }), Math.round(10 * S * S))
  const m = new THREE.Matrix4()
  const minX = Math.min(...L.tiles.map((t) => t.x)) - S / 2
  const minZ = Math.min(...L.tiles.map((t) => t.y)) - S / 2
  const spanX = Math.max(...L.tiles.map((t) => t.x)) + S / 2 - minX
  const spanZ = Math.max(...L.tiles.map((t) => t.y)) + S / 2 - minZ
  const free = (x: number, z: number, margin: number) =>
    onLand(x, z, margin) && !nearMountain(x, z, 0.3) && trees.every(([tx, tz, s]) => Math.hypot(x - tx, z - tz) > 0.4 * s + margin)
  for (let i = 0; i < tufts.count; i++) {
    let placed = false
    for (let k = 0; k < 30 && !placed; k++) {
      const x = minX + rand() * spanX
      const z = minZ + rand() * spanZ
      if (!free(x, z, 0)) continue
      m.makeTranslation(x, 0.07, z)
      placed = true
    }
    if (!placed) m.makeTranslation(0, -9, 0)
    tufts.setMatrixAt(i, m)
  }
  scene.add(tufts)
  const palette = [0xff8fb1, 0xffe066, 0xffffff, 0xc49bff, 0xff9a5c]
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4)
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d8a34 })
  const head = new THREE.SphereGeometry(0.05, 8, 6)
  for (let i = 0; i < Math.round(1.1 * S * S); i++) {
    const x = minX + rand() * spanX
    const z = minZ + rand() * spanZ
    if (!free(x, z, 0.1)) continue
    const s = new THREE.Mesh(stem, stemMat)
    s.position.set(x, 0.07, z)
    const h = new THREE.Mesh(head, new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.6 }))
    h.position.set(x, 0.15, z)
    scene.add(s, h)
  }
}

const TREES = L.trees
  .map(([dx, dz, s]) => [L.land.x + dx * S, L.land.y + dz * S, s] as [number, number, number])
  .filter(([x, z]) => onLand(x, z, 0.2) && !nearMountain(x, z, 0.5))
  .slice(0, 7)

for (const t of L.tiles) buildTile(t)
buildWater()
if (L.mountain) buildMountain(L.mountain)
const fx = L.waterfall ? buildWaterfall(L.waterfall) : null
buildFence()
for (const [x, z, s] of TREES) buildTree(x, z, s)
buildGreenery(TREES)

// ── 鏡頭與取景 ───────────────────────────────────────

/** 取景要包進去的點：兩塊地的外緣（柵欄頂、泥土底）＋石頭山頂＋瀑布下半段 */
const framePoints: THREE.Vector3[] = []
for (const t of L.tiles) {
  for (const p of outline(t, -0.12, 120)) for (const y of [0.45, -0.98]) framePoints.push(new THREE.Vector3(p.x, y, p.y))
}
if (L.mountain) framePoints.push(new THREE.Vector3(L.mountain.x, 2.0, L.mountain.y))
if (L.waterfall) {
  const f = L.waterfall
  for (const z of [f.z0, f.z1]) framePoints.push(new THREE.Vector3(f.x + FALL_OUT * 0.8, LIP_Y - FALL_DROP * 0.64, z))
}

/** 跟桌布模式一樣：寬度最多佔畫面 94%，底下留 4%，上面留 15% 給泡泡 */
const FRAME = { width: L.width ?? 0.94, bottom: 0.04, top: L.top ?? 0.15 }

function frame(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(yaw) * Math.cos(PITCH))
  camera.position.copy(dir.multiplyScalar(80))
  camera.up.set(0, 1, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const v = new THREE.Vector3()
  for (const p of framePoints) {
    v.copy(p).applyMatrix4(camera.matrixWorldInverse)
    minX = Math.min(minX, v.x)
    maxX = Math.max(maxX, v.x)
    minY = Math.min(minY, v.y)
    maxY = Math.max(maxY, v.y)
  }
  // 每個世界單位幾個像素：寬、高都要塞得下（底部要切掉的版本只看寬度）
  const byW = (w * FRAME.width) / (maxX - minX)
  const scale = L.cutBottom ? byW : Math.min(byW, (h * (1 - FRAME.top - FRAME.bottom)) / (maxY - minY))
  const cx = (minX + maxX) / 2
  camera.left = cx - w / 2 / scale
  camera.right = cx + w / 2 / scale
  // 最低的地方放在畫面底邊下面 cutBottom（被切掉），否則留 FRAME.bottom 的空
  camera.bottom = L.cutBottom ? minY + (h * L.cutBottom) / scale : minY - (h * FRAME.bottom) / scale
  camera.top = camera.bottom + h / scale
  camera.updateProjectionMatrix()
}

const clock = new THREE.Timer()
clock.connect(document)
function tick(time: number): void {
  clock.update(time)
  const t = clock.getElapsed()
  if (fx) {
    // 水簾往下流、水沫往外流、水霧一鼓一鼓
    fx.sheet.offset.y = -t * 0.9
    fx.foam.offset.x = -t * 0.5
    fx.foamMat.opacity = 0.45 + Math.sin(t * 2.3) * 0.1
    for (const m of fx.mist) {
      const k = (t * 0.35 + m.phase / (Math.PI * 2)) % 1
      m.sprite.position.copy(m.base).add(new THREE.Vector3(0.25 * k, 0.35 * k, 0))
      m.sprite.scale.setScalar(m.size * (0.7 + 0.6 * k))
      ;(m.sprite.material as THREE.SpriteMaterial).opacity = 0.42 * Math.sin(Math.PI * k)
    }
  }
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

window.addEventListener('resize', frame)
document.querySelector('#spin')!.addEventListener('click', () => {
  yaw += Math.PI / 2
  frame()
})
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-v]')) {
  b.classList.toggle('on', b.dataset.v === L.key)
  b.addEventListener('click', () => {
    location.search = `?v=${b.dataset.v}`
  })
}
// 版本 4 才有湖形按鈕
const lakes = document.querySelector<HTMLDivElement>('#lakes')!
lakes.hidden = L.key !== '4'
for (const shape of LAKE_SHAPES) {
  const b = document.createElement('button')
  b.textContent = shape.label
  b.classList.toggle('on', shape.id === LAKE_SHAPE)
  b.addEventListener('click', () => {
    location.search = `?v=4&lake=${shape.id}`
  })
  lakes.append(b)
}
// 有桌布截圖就用桌布當背景（開發伺服器有設 ISO_WALLPAPER 才有）
void fetch('/wallpaper.png', { method: 'HEAD' }).then((r) => {
  if (r.ok && r.headers.get('content-type')?.includes('image')) document.body.classList.add('wall')
})
document.querySelector('#bg')!.addEventListener('click', () => document.body.classList.toggle('wall'))
frame()
requestAnimationFrame(tick)
