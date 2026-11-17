/**
 * 日式賞櫻地圖的東西（ranch-maps.ts 的 sakura）。
 *
 * 2026-11-12 使用者「來個日式賞櫻，河流在右上，左邊有個大櫻花樹」；同一天「櫻花版太醜了，你設計個新的」→ 重新設計成池泉庭園：
 * - 櫻花樹：深色的樹幹、傘狀的樹冠，一小團一小團的花由上到下從淡粉到深粉（原本是幾顆大粉紅球，像棉花糖）
 * - 枝垂櫻：左邊的主角，樹冠寬、外圈垂下一串串花
 * - 太鼓橋、鳥居、小祠：朱紅色的重點，放在左上邊緣（畫面上方），不擋前面的寵物；橋只是裝飾，寵物不過橋、水系不游到橋下
 *   （2026-11-12 使用者「櫻花樹下的紅色家具移除」：原本枝垂櫻底下有紅氈長凳與野點傘，拿掉了，不要再加回來）
 * - 飛石小徑、石燈籠、景石、圓球矮樹、油菜花、地上的落花、水面的花筏、飄落的花瓣
 * - 鹿威し：竹筒接筧的水、裝滿就倒進石缽，再彈回來敲石頭（2026-11-13 加的；同一天使用者「竹子那個你重新設計，然後換去其他地方」→
 *   從池子右岸移到左邊橋頭右前方的草地上，底下鋪一圈碎石、加一個接水的石缽）
 * - 滝石組與後岸的松石（2026-11-13 使用者先看過預覽頁的三版，選「瀑布組」；後岸原本一排四棵櫻花，選「松與石組」）：
 *   池子後岸一座石山，瀑布從兩塊立石中間落進池子；石山一路矮下去沿著後岸接成一排石組，中間幾棵修過的松樹、開花的圓杜鵑、一座石塔
 *
 * 都用程式產生，不用圖檔。每樣東西的位置在 ranch-maps.ts 的 SakuraGarden。
 */
import * as THREE from 'three'

import { Batch, flat, placed, rand } from './batch'
import { WATER_Y } from './lake'
import type { RanchMap, RockGarden } from './ranch-maps'
import type { FallLook } from './snow'

/** 草地上落花的顏色（ranch-scene.ts 的 buildIsland 照 map.petals 混進草地色） */
export const PETAL_GROUND = 0xf4c6d4
/**
 * 賞櫻的地面與水（2026-11-12 使用者「賞櫻地面應該沒那麼綠」）：
 * 草地是淡一點的春草色，整片再淡淡帶一點粉紅（basePetal）；水岸是灰白的碎石，不是沙灘的黃；水偏青綠（庭園的池）
 */
export const SAKURA_GROUND = {
  grass: 0x93b382,
  grass2: 0xa0bd8d,
  tuft: 0x86a674,
  basePetal: 0.06,
  /** 櫻花樹底下的草地多帶多少粉紅（乘上 map.petals 的密度） */
  petalTint: 0.36,
  shore: 0xd9d4c6,
  shoreWet: 0xb7b3a4,
  bedShallow: 0x7fb0a0,
  bedDeep: 0x2f7c84,
}
export const SAKURA_WATER = 0x5fc0c6
export const SAKURA_WATER_OPACITY = 0.58
/** 柵欄、木門：深色的木頭（原本牧場的淺色木柵欄太搶眼） */
export const SAKURA_WOOD = { fence: 0x6d4c3b, gate: 0x4c352b }
/** 零星小花的顏色：只留白、淡粉、淡黃 */
export const SAKURA_FLOWERS = [0xffffff, 0xffdbe7, 0xfff0b3]

const VERMILION = 0xd6402d
const VERMILION_DARK = 0xa8362a
const INK = 0x2b2523
const BARK = 0x3f2c25
const STONE = 0x9d9b94

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface GardenObstacle {
  x: number
  z: number
  r: number
}

// ── 櫻花樹 ───────────────────────────────────────────

interface TreeMats {
  bark: THREE.Material
  /** 花：由淡到深四種粉紅。樹冠上面、中間用淡的，外圈、底下用深的，看起來才有受光的層次 */
  blossom: THREE.Material[]
}

function treeMats(): TreeMats {
  return {
    bark: new THREE.MeshStandardMaterial({ color: BARK, roughness: 1 }),
    blossom: [0xfdf0f4, 0xf9d3df, 0xf2b0c6, 0xe293b0].map((c) => flat(c, 0.85)),
  }
}

/** 一團花：壓扁的低多邊形球。shade 0（淡）～ 1（深） */
function puff(b: Batch, mats: TreeMats, base: THREE.Matrix4, p: THREE.Vector3, r: number, shade: number, detail = 1): void {
  const v = THREE.MathUtils.clamp(shade + rand(-0.14, 0.14), 0, 0.999)
  const mat = mats.blossom[v < 0.28 ? 0 : v < 0.6 ? 1 : v < 0.86 ? 2 : 3]
  b.put(new THREE.IcosahedronGeometry(1, detail), mat, base, p, new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(r, r * rand(0.62, 0.78), r))
}

/**
 * 傘狀的樹冠：花團撒在一個往外垂的圓頂上。radius 樹冠半徑、top 頂端高度、drop 外圈比頂端低多少。
 * 越靠外、越低的花團顏色越深，最底下再補一圈深色的當陰影面
 */
function canopy(b: Batch, mats: TreeMats, base: THREE.Matrix4, radius: number, top: number, drop: number, count: number, size: [number, number]): void {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2)
    // 平均撒在圓盤上；最中間留一團固定在頂端
    const k = i === 0 ? 0 : Math.sqrt((i + rand(-0.4, 0.4)) / count)
    const rho = radius * k
    const y = top - k * k * drop + rand(-0.06, 0.06) * radius
    puff(b, mats, base, new THREE.Vector3(Math.cos(a) * rho, y, Math.sin(a) * rho), rand(size[0], size[1]) * (1 - 0.25 * k), 0.12 + 0.62 * k * k)
  }
  const under = Math.round(count * 0.3)
  for (let i = 0; i < under; i++) {
    const a = rand(0, Math.PI * 2)
    const k = rand(0.35, 0.95)
    const y = top - k * k * drop - rand(0.16, 0.28) * radius
    puff(b, mats, base, new THREE.Vector3(Math.cos(a) * radius * k, y, Math.sin(a) * radius * k), rand(size[0], size[1]) * 0.7, 0.9)
  }
}

/** 一般的櫻花樹：樹幹微微歪、三根往外的枝、傘狀樹冠。高約 2 × size */
function sakuraTree(b: Batch, mats: TreeMats, x: number, z: number, size: number): void {
  const base = placed(x, z, rand(0, Math.PI * 2), size)
  const fork = new THREE.Vector3(rand(-0.06, 0.06), 0.72, rand(-0.06, 0.06))
  b.rod(mats.bark, base, new THREE.Vector3(0, 0, 0), fork, 0.125, 0.085)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand(-0.35, 0.35)
    const tilt = rand(0.6, 0.9)
    const len = rand(0.55, 0.75)
    const tip = fork.clone().add(new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).multiplyScalar(len))
    b.rod(mats.bark, base, fork, tip, 0.06, 0.03, 5)
  }
  canopy(b, mats, base, 1.0, 1.82, 0.52, 18, [0.3, 0.42])
}

/**
 * 枝垂櫻（主角）：粗的樹幹分兩段歪上去，六根長枝撐開一個寬樹冠，外圈垂下一串串小花團。高約 4 × size。
 * 垂下來的花串只到樹冠高度的一半左右，不會整片蓋到地上
 */
function weepingSakura(b: Batch, mats: TreeMats, x: number, z: number, size: number): void {
  const base = placed(x, z, rand(0, Math.PI * 2), size)
  const knee = new THREE.Vector3(0.1, 0.95, 0.04)
  const fork = new THREE.Vector3(-0.06, 1.65, -0.05)
  b.rod(mats.bark, base, new THREE.Vector3(0, 0, 0), knee, 0.36, 0.26, 9)
  b.rod(mats.bark, base, knee, fork, 0.27, 0.19, 9)
  // 樹根：幾塊往外的小隆起
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand(-0.3, 0.3)
    b.rod(mats.bark, base, new THREE.Vector3(0, 0.22, 0), new THREE.Vector3(Math.cos(a) * 0.5, -0.02, Math.sin(a) * 0.5), 0.16, 0.07, 5)
  }
  const radius = 2.5
  const top = 3.8
  const drop = 1.15
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand(-0.25, 0.25)
    const tilt = rand(0.75, 1.05)
    const len = rand(1.5, 2.0)
    const tip = fork.clone().add(new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).multiplyScalar(len))
    b.rod(mats.bark, base, fork, tip, 0.13, 0.05, 6)
  }
  canopy(b, mats, base, radius, top, drop, 62, [0.5, 0.74])
  // 垂下來的花串：從樹冠外圈往下一顆顆變小
  for (let i = 0; i < 38; i++) {
    const a = rand(0, Math.PI * 2)
    const k = rand(0.68, 1.03)
    const beads = Math.round(rand(4, 8))
    let rho = radius * k
    let y = top - k * k * drop - 0.3
    for (let n = 0; n < beads && y > 1.25; n++) {
      puff(b, mats, base, new THREE.Vector3(Math.cos(a) * rho + rand(-0.04, 0.04), y, Math.sin(a) * rho + rand(-0.04, 0.04)), 0.19 - n * 0.012, 0.45 + n * 0.07, 0)
      y -= 0.21
      rho += 0.03
    }
  }
}

// ── 石燈籠 ───────────────────────────────────────────

/** 石燈籠：台座、竿、中台、火袋（暖色的窗）、笠（四角屋頂）、寶珠 */
function stoneLantern(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  const base = placed(x, z, Math.PI / 4, 1.15)
  const stone = flat(STONE, 0.95)
  const at = (geo: THREE.BufferGeometry, y: number, rotY = 0) => b.put(geo, stone, base, new THREE.Vector3(0, y, 0), new THREE.Euler(0, rotY, 0))
  at(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 6), 0.05)
  at(new THREE.CylinderGeometry(0.07, 0.09, 0.42, 8), 0.31)
  at(new THREE.CylinderGeometry(0.2, 0.15, 0.08, 6), 0.56)
  at(new THREE.BoxGeometry(0.24, 0.2, 0.24), 0.7)
  // 笠：四角錐轉 45°，邊緣比火袋寬
  at(new THREE.ConeGeometry(0.33, 0.2, 4), 0.9, Math.PI / 4)
  at(new THREE.SphereGeometry(0.06, 8, 6), 1.03)
  // 火袋裡發亮的窗（兩個方向各一片）
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc46b, emissiveIntensity: 0.9, roughness: 0.6 })
  b.put(new THREE.BoxGeometry(0.255, 0.1, 0.12), glow, base, new THREE.Vector3(0, 0.71, 0))
  b.put(new THREE.BoxGeometry(0.12, 0.1, 0.255), glow, base, new THREE.Vector3(0, 0.71, 0))
  b.build(world)
}

// ── 太鼓橋 ───────────────────────────────────────────

/**
 * 太鼓橋：朱紅色的拱橋，沿 z 方向從 z0 跨到 z1（x 是中心線）。橋面是一片片沿著圓弧排的木板，兩邊有柱子、扶手與深色的擬寶珠。
 * 只是裝飾：陸地的寵物不過橋（兩頭與中間各放一個障礙圓），小溪窄到水系也不會游到橋下
 */
function archBridge(world: THREE.Object3D, x: number, z0: number, z1: number): void {
  const b = new Batch()
  const base = placed(x, (z0 + z1) / 2)
  const len = Math.abs(z1 - z0)
  const rise = 0.62
  const width = 0.96
  const deck = flat(0x9a3a2b, 0.85)
  const red = flat(VERMILION, 0.75)
  const ink = flat(INK, 0.6)
  const at = (t: number) => new THREE.Vector3(0, 0.05 + rise * Math.sin(Math.PI * t), (t - 0.5) * len)
  const slope = (t: number) => Math.atan((rise * Math.PI * Math.cos(Math.PI * t)) / len)
  const planks = 16
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) / planks
    const p = at(t)
    const tilt = new THREE.Euler(-slope(t), 0, 0)
    b.put(new THREE.BoxGeometry(width, 0.05, (len / planks) * 1.12), deck, base, p, tilt)
    const seg = (len / planks) * 1.15
    for (const sx of [-1, 1]) {
      // 橋面兩側的邊梁、扶手、中間那根橫桿
      b.put(new THREE.BoxGeometry(0.08, 0.11, seg), red, base, p.clone().add(new THREE.Vector3((sx * width) / 2, -0.01, 0)), tilt)
      b.put(new THREE.BoxGeometry(0.065, 0.06, seg), red, base, p.clone().add(new THREE.Vector3((sx * width) / 2, 0.44, 0)), tilt)
      b.put(new THREE.BoxGeometry(0.04, 0.04, seg), red, base, p.clone().add(new THREE.Vector3((sx * width) / 2, 0.24, 0)), tilt)
    }
  }
  for (const t of [0.02, 0.26, 0.5, 0.74, 0.98]) {
    const p = at(t)
    for (const sx of [-1, 1]) {
      const end = t < 0.1 || t > 0.9
      const h = end ? 0.6 : 0.5
      b.put(new THREE.BoxGeometry(0.09, h, 0.09), red, base, p.clone().add(new THREE.Vector3((sx * width) / 2, h / 2, 0)))
      b.put(new THREE.ConeGeometry(0.075, 0.12, 6), ink, base, p.clone().add(new THREE.Vector3((sx * width) / 2, h + 0.06, 0)))
    }
  }
  b.build(world)
}

// ── 鳥居、小祠 ───────────────────────────────────────

/** 鳥居（明神鳥居）：兩根微微內傾的朱紅柱子、貫、島木，最上面一根兩端上翹的黑色笠木。開口朝 z */
function torii(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  const base = placed(x, z)
  const red = new THREE.MeshStandardMaterial({ color: VERMILION, roughness: 0.7 })
  const ink = flat(INK, 0.6)
  const stone = flat(0x77756f, 0.95)
  for (const sx of [-1, 1]) {
    b.rod(red, base, new THREE.Vector3(sx * 0.66, 0.08, 0), new THREE.Vector3(sx * 0.6, 1.72, 0), 0.095, 0.075, 10)
    b.put(new THREE.CylinderGeometry(0.14, 0.17, 0.12, 8), stone, base, new THREE.Vector3(sx * 0.66, 0.06, 0))
    // 笠木兩端往上翹
    b.put(new THREE.BoxGeometry(0.36, 0.09, 0.18), ink, base, new THREE.Vector3(sx * 1.08, 1.815, 0), new THREE.Euler(0, 0, sx * 0.24))
  }
  b.put(new THREE.BoxGeometry(1.66, 0.1, 0.08), red, base, new THREE.Vector3(0, 1.3, 0))
  b.put(new THREE.BoxGeometry(0.09, 0.24, 0.06), red, base, new THREE.Vector3(0, 1.47, 0))
  b.put(new THREE.BoxGeometry(1.92, 0.1, 0.13), red, base, new THREE.Vector3(0, 1.66, 0))
  b.put(new THREE.BoxGeometry(1.9, 0.1, 0.18), ink, base, new THREE.Vector3(0, 1.77, 0))
  b.build(world)
}

/** 小祠：石台、木頭的小屋、朱紅的門、深色的山形屋頂（正面朝 +z，對著鳥居） */
function shrine(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  const base = placed(x, z)
  const stone = flat(STONE, 0.95)
  const wood = flat(0x8a5a3c, 0.9)
  const red = flat(VERMILION_DARK, 0.75)
  const roof = flat(0x3b464e, 0.8)
  b.put(new THREE.BoxGeometry(0.82, 0.14, 0.7), stone, base, new THREE.Vector3(0, 0.07, 0))
  b.put(new THREE.BoxGeometry(0.5, 0.07, 0.2), stone, base, new THREE.Vector3(0, 0.035, 0.44))
  b.put(new THREE.BoxGeometry(0.5, 0.44, 0.42), wood, base, new THREE.Vector3(0, 0.36, 0))
  b.put(new THREE.BoxGeometry(0.28, 0.3, 0.03), red, base, new THREE.Vector3(0, 0.33, 0.215))
  for (const sx of [-1, 1]) {
    b.put(new THREE.BoxGeometry(0.5, 0.05, 0.8), roof, base, new THREE.Vector3(sx * 0.19, 0.71, 0.02), new THREE.Euler(0, 0, -sx * 0.66))
  }
  b.put(new THREE.BoxGeometry(0.08, 0.07, 0.88), roof, base, new THREE.Vector3(0, 0.88, 0.02))
  b.build(world)
}

// ── 鹿威し ───────────────────────────────────────────

/**
 * 鹿威し（2026-11-13 使用者「日式賞櫻最右邊加上一個日本造景常見的裝置，是一個竹子，有水滴在上面」）：
 * 筧（竹管）的水一滴一滴滴進斜放的竹筒，裝滿了竹筒往前倒、把水倒進石缽，再彈回來敲在叩き石上。
 *
 * 2026-11-13 使用者「竹子那個你重新設計，然後換去其他地方」：原本立在池子右岸、筧的立柱插在池水裡、水直接倒進池子，
 * 遠看只是幾根交叉的綠竹竿。現在是草地上獨立的一組：底下一圈碎石地、邊上壓幾顆石頭，竹筒前面一個盛著水的石缽接水，
 * 竹子粗一點、顏色分成青竹與曬乾的黃竹，短柱和筧用黑色的棕繩綁著。
 *
 * 竹筒沿 x 放，開口朝 -x，轉軸在兩根短柱之間；筧從後面（-z，離鏡頭遠的那側）伸過來，出水口在開口正上方。
 * 沒有音效：每幾秒敲一次，開著桌布模式會吵。
 */
const BAMBOO = 0x7f9c4c
const BAMBOO_NODE = 0x63813a
/** 竹筒轉軸的高度、轉軸到開口與到底部的距離 */
const SOZU_PIVOT = new THREE.Vector3(0.1, 0.58, 0)
/** 接水的石缽：水面的高度、中心的 x（竹筒倒下去時開口的正下方） */
const SOZU_SCALE = 1.3
const SOZU_BASIN_Y = 0.13
const SOZU_BASIN_X = -0.46
/** 曬乾的黃竹（短柱、筧的立柱）與綁竹子的棕繩 */
const BAMBOO_DRY = 0xc9b676
const PALM_ROPE = 0x2e2a26
const SOZU_OPEN = 0.62
const SOZU_BACK = 0.38
/** 竹筒的角度（繞 z）：負的是開口朝上、底部壓在石頭上；正的是開口朝下在倒水 */
const SOZU_REST = -0.5
const SOZU_FULL = -0.4
const SOZU_TIPPED = 0.55
/** 一輪的時間（秒）：滴水、倒下去、倒水、彈回來 */
const SOZU_FILL = 3.6
const SOZU_TIP = 0.4
const SOZU_POUR = 0.55
const SOZU_BACK_TIME = 0.3
const DRIP_EVERY = 0.32

class ShishiOdoshi {
  private readonly pivot = new THREE.Group()
  private readonly drops: THREE.Mesh[] = []
  private readonly stream: THREE.Mesh
  private readonly spout: THREE.Vector3
  private readonly mouth: THREE.Vector3
  private t = Math.random() * SOZU_FILL

  constructor(world: THREE.Object3D, x: number, z: number) {
    const root = new THREE.Group()
    root.position.set(x, 0, z)
    // 整組放大一點：照實際比例做的話，在整座小島的畫面上小到看不出是什麼
    root.scale.setScalar(SOZU_SCALE)
    world.add(root)
    const bamboo = flat(BAMBOO, 0.7)
    const node = flat(BAMBOO_NODE, 0.75)
    const id = new THREE.Matrix4()

    const dry = flat(BAMBOO_DRY, 0.75)
    const rope = flat(PALM_ROPE, 1)
    const stone = [flat(0x8e8b85, 1), flat(0x7d8072, 1), flat(0x9a968d, 1)]

    // 不動的部分：碎石地與壓邊的石頭、兩根短柱與轉軸、叩き石、石缽、筧（立柱＋橫的竹管）
    const still = new Batch()
    still.put(new THREE.CylinderGeometry(0.82, 0.86, 0.03, 14), flat(0xd3cfc2, 1), id, new THREE.Vector3(-0.05, 0.015, -0.05))
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2)
      const r = rand(0.1, 0.74)
      still.put(new THREE.IcosahedronGeometry(rand(0.035, 0.06), 0), stone[i % 3], id, new THREE.Vector3(-0.05 + Math.cos(a) * r, 0.035, -0.05 + Math.sin(a) * r), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.5, 1))
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand(-0.15, 0.15)
      const r = rand(0.1, 0.16)
      still.put(new THREE.DodecahedronGeometry(r, 0), stone[i % 3], id, new THREE.Vector3(-0.05 + Math.cos(a) * 0.82, r * 0.3, -0.05 + Math.sin(a) * 0.82), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
    }
    for (const sz of [-1, 1]) {
      still.put(new THREE.CylinderGeometry(0.05, 0.055, SOZU_PIVOT.y + 0.1, 7), dry, id, new THREE.Vector3(SOZU_PIVOT.x, (SOZU_PIVOT.y + 0.1) / 2, sz * 0.15))
      still.put(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 7), rope, id, new THREE.Vector3(SOZU_PIVOT.x, SOZU_PIVOT.y - 0.09, sz * 0.15))
    }
    still.put(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 6), rope, id, SOZU_PIVOT.clone(), new THREE.Euler(Math.PI / 2, 0, 0))
    // 叩き石：竹筒彈回來時底部敲的那塊
    const backX = SOZU_PIVOT.x + SOZU_BACK * Math.cos(SOZU_REST)
    still.put(new THREE.DodecahedronGeometry(0.2, 0), stone[1], id, new THREE.Vector3(backX + 0.02, 0.14, 0), new THREE.Euler(0.4, 0.7, 0), new THREE.Vector3(1.1, 0.85, 1))
    // 石缽：一圈粗粗的石頭、中間盛著水
    still.put(new THREE.CylinderGeometry(0.25, 0.3, SOZU_BASIN_Y + 0.04, 9), stone[0], id, new THREE.Vector3(SOZU_BASIN_X, (SOZU_BASIN_Y + 0.04) / 2, 0), new THREE.Euler(0, 0.3, 0))
    still.put(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 14), new THREE.MeshStandardMaterial({ color: 0x6fc4cc, roughness: 0.15 }), id, new THREE.Vector3(SOZU_BASIN_X, SOZU_BASIN_Y + 0.036, 0))
    // 筧：開口（靜止時）的正上方出水；立柱立在碎石地後面
    this.mouth = new THREE.Vector3(SOZU_PIVOT.x - SOZU_OPEN * Math.cos(SOZU_REST), SOZU_PIVOT.y - SOZU_OPEN * Math.sin(SOZU_REST), 0)
    this.spout = new THREE.Vector3(this.mouth.x, this.mouth.y + 0.3, 0.03)
    const postZ = -0.5
    const postTop = this.spout.y + 0.16
    still.put(new THREE.CylinderGeometry(0.065, 0.07, postTop, 8), dry, id, new THREE.Vector3(this.spout.x, postTop / 2, postZ))
    still.put(new THREE.CylinderGeometry(0.074, 0.074, 0.05, 8), rope, id, new THREE.Vector3(this.spout.x, this.spout.y + 0.04, postZ))
    still.rod(bamboo, id, new THREE.Vector3(this.spout.x, this.spout.y + 0.05, postZ - 0.12), new THREE.Vector3(this.spout.x, this.spout.y + 0.02, this.spout.z), 0.042, 0.038, 7)
    still.put(new THREE.CircleGeometry(0.032, 8), flat(0x2f3a22, 1), id, new THREE.Vector3(this.spout.x, this.spout.y + 0.02, this.spout.z + 0.001))
    still.build(root)

    // 會動的竹筒：中心在轉軸，開口在 -x、底部（竹節封住）在 +x，中間一圈竹節
    const len = SOZU_OPEN + SOZU_BACK
    const tube = new Batch()
    tube.put(new THREE.CylinderGeometry(0.075, 0.075, len, 10), bamboo, id, new THREE.Vector3((SOZU_BACK - SOZU_OPEN) / 2, 0, 0), new THREE.Euler(0, 0, Math.PI / 2))
    for (const nx of [SOZU_BACK - 0.02, -0.2]) {
      tube.put(new THREE.CylinderGeometry(0.081, 0.081, 0.03, 10), node, id, new THREE.Vector3(nx, 0, 0), new THREE.Euler(0, 0, Math.PI / 2))
    }
    // 開口：裡面暗暗的一圈（竹筒是空心的）
    tube.put(new THREE.CircleGeometry(0.062, 10), flat(0x2f3a22, 1), id, new THREE.Vector3(-SOZU_OPEN - 0.001, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0))
    tube.build(this.pivot)
    this.pivot.position.copy(SOZU_PIVOT)
    root.add(this.pivot)

    // 水滴（輪流用三顆）與倒水時的水柱
    const water = new THREE.MeshStandardMaterial({ color: 0xbfe8ef, transparent: true, opacity: 0.85, roughness: 0.2 })
    for (let i = 0; i < 3; i++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), water)
      drop.scale.set(1, 1.5, 1)
      drop.visible = false
      root.add(drop)
      this.drops.push(drop)
    }
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe8ef, transparent: true, opacity: 0.6, roughness: 0.2 }))
    this.stream.visible = false
    root.add(this.stream)
  }

  update(dt: number): void {
    this.t = (this.t + dt) % (SOZU_FILL + SOZU_TIP + SOZU_POUR + SOZU_BACK_TIME)
    const t = this.t
    let angle: number
    if (t < SOZU_FILL) {
      // 越裝越滿，開口那頭慢慢沉下來一點
      angle = THREE.MathUtils.lerp(SOZU_REST, SOZU_FULL, (t / SOZU_FILL) ** 2)
    } else if (t < SOZU_FILL + SOZU_TIP) {
      const k = (t - SOZU_FILL) / SOZU_TIP
      angle = THREE.MathUtils.lerp(SOZU_FULL, SOZU_TIPPED, k * k)
    } else if (t < SOZU_FILL + SOZU_TIP + SOZU_POUR) {
      angle = SOZU_TIPPED
    } else {
      // 彈回來：先過頭一點點（敲到石頭）再停住
      const k = (t - SOZU_FILL - SOZU_TIP - SOZU_POUR) / SOZU_BACK_TIME
      angle = k < 0.7 ? THREE.MathUtils.lerp(SOZU_TIPPED, SOZU_REST - 0.04, (k / 0.7) ** 2) : THREE.MathUtils.lerp(SOZU_REST - 0.04, SOZU_REST, (k - 0.7) / 0.3)
    }
    this.pivot.rotation.z = angle

    // 滴水：只在接水的時候滴，從出水口掉到竹筒開口
    const fall = this.spout.y - this.mouth.y
    const fallTime = Math.sqrt((2 * fall) / 9.8)
    const cycle = DRIP_EVERY * this.drops.length
    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i]
      const since = t - i * DRIP_EVERY
      const phase = since - Math.floor(since / cycle) * cycle
      const falling = phase < fallTime && t < SOZU_FILL - 0.1
      drop.visible = falling
      if (falling) drop.position.set(this.spout.x, this.spout.y - 0.5 * 9.8 * phase * phase, this.spout.z * (1 - phase / fallTime))
    }

    // 倒水：開口朝下的時候，從開口拉一條水柱到石缽的水面
    const pouring = t > SOZU_FILL + SOZU_TIP * 0.6 && t < SOZU_FILL + SOZU_TIP + SOZU_POUR
    this.stream.visible = pouring
    if (pouring) {
      const ox = SOZU_PIVOT.x - SOZU_OPEN * Math.cos(angle)
      const oy = SOZU_PIVOT.y - SOZU_OPEN * Math.sin(angle)
      const h = Math.max(0.05, oy - SOZU_BASIN_Y)
      this.stream.scale.set(1, h, 1)
      this.stream.position.set(ox - 0.03, oy - h / 2, 0)
    }
  }
}

// ── 地上的東西 ───────────────────────────────────────

/** 飛石：沿著小徑一塊塊扁平的石頭，左右微微錯開、大小不一（很扁，寵物直接踩過去） */
function steppingStones(world: THREE.Object3D, pts: [number, number][]): void {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)))
  const n = Math.max(2, Math.round(curve.getLength() / 0.62))
  const b = new Batch()
  const mats = [flat(0xa3a098, 1), flat(0x94918a, 1)]
  const id = new THREE.Matrix4()
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    const side = (i % 2 === 0 ? 1 : -1) * rand(0.03, 0.1)
    p.x += -tan.z * side
    p.z += tan.x * side
    p.y = 0.022
    const r = rand(0.2, 0.27)
    b.put(new THREE.CylinderGeometry(r * 0.9, r, 0.045, 7), mats[i % 2], id, p, new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(rand(0.85, 1.15), 1, rand(0.85, 1.1)))
  }
  b.build(world)
}

/** 景石（一大一小兩塊）與圓球矮樹 */
function rocksAndShrubs(world: THREE.Object3D, rocks: [number, number, number][], shrubs: [number, number, number][]): void {
  const b = new Batch()
  const id = new THREE.Matrix4()
  const rockMats = [flat(0x8e8b85, 1), flat(0x7d8072, 1)]
  rocks.forEach(([x, z, s], i) => {
    b.put(new THREE.DodecahedronGeometry(s, 0), rockMats[i % 2], id, new THREE.Vector3(x, s * 0.32, z), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.72, 1))
    const a = rand(0, Math.PI * 2)
    b.put(new THREE.DodecahedronGeometry(s * 0.5, 0), rockMats[(i + 1) % 2], id, new THREE.Vector3(x + Math.cos(a) * s * 1.1, s * 0.16, z + Math.sin(a) * s * 1.1), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
  })
  const shrubMats = [flat(0x5f8f58, 0.95), flat(0x6f9d63, 0.95)]
  shrubs.forEach(([x, z, s], i) => {
    b.put(new THREE.IcosahedronGeometry(s, 1), shrubMats[i % 2], id, new THREE.Vector3(x, s * 0.42, z), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1, 0.68, 1))
    b.put(new THREE.IcosahedronGeometry(s * 0.62, 1), shrubMats[(i + 1) % 2], id, new THREE.Vector3(x + s * 0.75, s * 0.28, z + s * 0.35), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1, 0.68, 1))
  })
  b.build(world)
}

/** 油菜花：一根細莖、頂端一小團黃花，照 density(x, z) 的機率撒（InstancedMesh，莖與花各畫一次） */
function nanohana(world: THREE.Object3D, density: (x: number, z: number) => number, count = 900): void {
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.01, 0.014, 1, 4), new THREE.MeshStandardMaterial({ color: 0x7fa650, roughness: 1 }), count)
  const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), flat(0xffffff, 0.7), count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const color = new THREE.Color()
  const yellows = [0xf7d54a, 0xfbe36a, 0xf0c53a]
  let n = 0
  for (let i = 0; i < count * 60 && n < count; i++) {
    const x = rand(-8.2, 8.2)
    const z = rand(-8.2, 8.2)
    if (Math.random() > density(x, z)) continue
    const h = rand(0.2, 0.34)
    stems.setMatrixAt(n, m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h, 1)))
    const r = rand(0.055, 0.085)
    heads.setMatrixAt(n, m.compose(new THREE.Vector3(x, h + r * 0.4, z), q, new THREE.Vector3(r, r * 0.8, r)))
    heads.setColorAt(n, color.setHex(yellows[n % yellows.length]))
    n++
  }
  stems.count = heads.count = n
  world.add(stems, heads)
}

/** 一片片很小的扁平花瓣（InstancedMesh）：spot 回傳下一片放哪裡（null 就跳過），y 是高度 */
function petalField(world: THREE.Object3D, count: number, y: number, spot: () => [number, number] | null, renderOrder = 0): void {
  const geo = new THREE.CircleGeometry(0.045, 6).rotateX(-Math.PI / 2)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide })
  const petals = new THREE.InstancedMesh(geo, mat, count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const color = new THREE.Color()
  const shades = [0xfad7e1, 0xf6bccd, 0xfde7ee, 0xf2acc3]
  let placedCount = 0
  for (let i = 0; i < count * 50 && placedCount < count; i++) {
    const p = spot()
    if (!p) continue
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2)
    const s = rand(0.7, 1.3)
    petals.setMatrixAt(placedCount, m.compose(new THREE.Vector3(p[0], y + Math.random() * 0.004, p[1]), q, new THREE.Vector3(s * 0.6, 1, s)))
    petals.setColorAt(placedCount, color.setHex(shades[placedCount % shades.length]))
    placedCount++
  }
  petals.count = placedCount
  petals.renderOrder = renderOrder
  world.add(petals)
}

/** 花瓣貼圖：一片粉紅的小橢圓，中間淡、邊緣深 */
function petalTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  g.translate(16, 16)
  g.rotate(0.6)
  const grad = g.createRadialGradient(0, -2, 0, 0, 0, 14)
  grad.addColorStop(0, 'rgba(255,228,238,1)')
  grad.addColorStop(0.6, 'rgba(250,170,198,0.96)')
  grad.addColorStop(1, 'rgba(244,150,184,0)')
  g.fillStyle = grad
  g.beginPath()
  g.ellipse(0, 0, 7, 12, 0, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 飄落的花瓣：比雪慢、晃得比較大、稍微大一點 */
export const PETAL_LOOK: FallLook = { color: 0xffffff, size: 5.5, speed: [0.22, 0.42], sway: 0.45, texture: petalTexture }

// ── 石組、瀑布、松樹（2026-11-13） ───────────────────

const GARDEN_STONES = [0x8e8b85, 0x7d8072, 0x6f716b, 0x9a968d]
const GARDEN_MOSS = [0x6f9a55, 0x5f8a4c]

interface StoneMats {
  stone: THREE.Material[]
  moss: THREE.Material[]
}

function stoneMats(): StoneMats {
  return { stone: GARDEN_STONES.map((c) => flat(c, 1)), moss: GARDEN_MOSS.map((c) => flat(c, 1)) }
}

/**
 * 一塊景石：底部埋進地裡一點，露出來的高度是 h。w、d 是寬與深；tilt 是往旁邊歪多少；moss 是頂上長不長青苔
 */
function gardenStone(b: Batch, mats: StoneMats, x: number, y: number, z: number, w: number, h: number, d: number, moss = false, tilt = 0.12): void {
  const id = new THREE.Matrix4()
  const sy = h / 1.7
  const mat = mats.stone[Math.floor(rand(0, mats.stone.length)) % mats.stone.length]
  b.put(new THREE.DodecahedronGeometry(1, 0), mat, id, new THREE.Vector3(x, y + sy * 0.7, z), new THREE.Euler(rand(-tilt, tilt), rand(0, 6.28), rand(-tilt, tilt)), new THREE.Vector3(w, sy, d))
  if (moss) {
    b.put(new THREE.IcosahedronGeometry(1, 1), mats.moss[Math.floor(rand(0, 2)) % 2], id, new THREE.Vector3(x, y + h * 0.9, z), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(w * 0.72, Math.min(0.1, h * 0.14), d * 0.72))
  }
}

/** 修過的松樹（庭木）：彎彎的樹幹，枝頭一片片壓扁的深綠色雲片。高約 1.6 × size */
function gardenPine(b: Batch, x: number, z: number, size: number, turn: number): void {
  const base = placed(x, z, turn, size)
  const bark = flat(0x4a3428, 1)
  const needles = [flat(0x2f6b46, 0.95), flat(0x3b7a50, 0.95)]
  const trunk = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.16, 0.5, 0.04), new THREE.Vector3(-0.08, 0.95, 0.1), new THREE.Vector3(0.14, 1.4, 0)]
  for (let i = 0; i + 1 < trunk.length; i++) b.rod(bark, base, trunk[i], trunk[i + 1], 0.09 - i * 0.02, 0.07 - i * 0.02, 6)
  const pads: [THREE.Vector3, THREE.Vector3, number][] = [
    [trunk[3], new THREE.Vector3(0.1, 1.55, 0), 0.4],
    [trunk[2], new THREE.Vector3(-0.5, 1.02, 0.2), 0.36],
    [trunk[1], new THREE.Vector3(0.6, 0.72, -0.12), 0.34],
    [trunk[2], new THREE.Vector3(0.38, 1.12, 0.36), 0.26],
  ]
  pads.forEach(([from, to, r], i) => {
    b.rod(bark, base, from, to, 0.035, 0.02, 5)
    b.put(new THREE.IcosahedronGeometry(r, 1), needles[i % 2], base, to.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1, 0.42, 1))
  })
}

/** 瀑布的水紋：淡青色底上幾條直的白線 */
function streakTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(214,240,244,0.78)'
  g.fillRect(0, 0, 64, 128)
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(255,255,255,${rand(0.35, 0.95)})`
    g.fillRect(rand(0, 62), rand(0, 128), rand(1.5, 4), rand(18, 60))
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * 滝石組：池子後岸的石山與瀑布。(x, z) 是瀑布落水口那塊最高的石頭；瀑布朝 +z 落進池子。
 * 後面一排高的石頭當背景（中間最高）、前面兩塊立石夾著瀑布、落水口一塊平石、水落下去的地方幾塊小石頭、水花與水波。
 * 水簾的水紋會往下流（update）
 */
class Waterfall {
  private readonly flow: THREE.Texture

  constructor(world: THREE.Object3D, x: number, z: number) {
    const mats = stoneMats()
    const b = new Batch()
    const id = new THREE.Matrix4()
    const wall: [number, number, number, number, number][] = [
      [-2.4, 0.16, 0.55, 0.9, 0.45],
      [-1.4, 0.06, 0.8, 1.9, 0.52],
      [0, 0, 1.0, 2.75, 0.5],
      [1.3, 0.06, 0.85, 2.1, 0.52],
      [2.3, 0.21, 0.55, 1.2, 0.45],
    ]
    for (const [dx, dz, w, h, d] of wall) gardenStone(b, mats, x + dx, 0, z + dz, w, h, d, true, 0.08)
    gardenStone(b, mats, x - 0.78, 0, z + 0.61, 0.5, 1.75, 0.46, true, 0.06)
    gardenStone(b, mats, x + 0.8, 0, z + 0.64, 0.52, 1.5, 0.46, true, 0.06)
    gardenStone(b, mats, x - 1.6, 0, z + 0.76, 0.42, 0.8, 0.38, false, 0.2)
    gardenStone(b, mats, x + 1.65, 0, z + 0.81, 0.44, 0.65, 0.4, true, 0.2)
    // 落水口的平石（滝口），與水落下去的地方兩旁的小石頭（貼著岸，水系游不到這麼淺）
    b.put(new THREE.DodecahedronGeometry(1, 0), mats.stone[2], id, new THREE.Vector3(x, 1.58, z + 0.36), new THREE.Euler(0.1, 0.6, 0), new THREE.Vector3(0.6, 0.22, 0.4))
    gardenStone(b, mats, x - 0.72, WATER_Y - 0.1, z + 0.98, 0.24, 0.26, 0.2, true, 0.25)
    gardenStone(b, mats, x + 0.7, WATER_Y - 0.1, z + 1.0, 0.2, 0.22, 0.18, false, 0.25)
    b.build(world)

    // 水簾：上面一小段平流，再落進池子
    const pts: [number, number][] = [
      [0.16, 1.8],
      [0.54, 1.78],
      [0.68, 1.5],
      [0.8, 0.7],
      [0.86, WATER_Y],
    ]
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    let run = 0
    pts.forEach(([dz, y], i) => {
      if (i > 0) run += Math.hypot(dz - pts[i - 1][0], y - pts[i - 1][1])
      const w = 0.62 + (0.22 * i) / (pts.length - 1)
      pos.push(x - w / 2, y, z + dz, x + w / 2, y, z + dz)
      uv.push(0, -run * 0.7, 1, -run * 0.7)
      if (i > 0) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2)
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    this.flow = streakTexture()
    const sheet = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.flow, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    sheet.renderOrder = 3
    world.add(sheet)

    // 水花與半圈半圈的水波
    const foam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.1, 0.19), 1), foam)
      puff.position.set(x + rand(-0.45, 0.45), WATER_Y + rand(0.02, 0.12), z + 0.9 + rand(-0.04, 0.16))
      puff.scale.y = 0.6
      puff.renderOrder = 4
      world.add(puff)
    }
    for (const [r, o] of [
      [0.5, 0.5],
      [0.85, 0.3],
      [1.2, 0.16],
    ]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 40, 1, 0, Math.PI).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, depthWrite: false }))
      // 半圈，開口朝後（水波只往池子這邊散）
      ring.rotation.y = Math.PI
      ring.position.set(x, WATER_Y + 0.006, z + 0.88)
      ring.renderOrder = 2
      world.add(ring)
    }
  }

  update(dt: number): void {
    this.flow.offset.y = (this.flow.offset.y + dt * 0.6) % 1
  }
}

/** 石塔：方形的基座上疊五層（一層塔身＋一片往外挑的屋簷），頂上一根相輪。高約 1.7 */
function stonePagoda(b: Batch, x: number, z: number): void {
  const base = placed(x, z)
  const mat = flat(0xa3a199, 1)
  const dark = flat(0x8b8982, 1)
  b.put(new THREE.BoxGeometry(0.5, 0.14, 0.5), dark, base, new THREE.Vector3(0, 0.07, 0))
  let y = 0.14
  for (let i = 0; i < 5; i++) {
    const w = 0.3 - i * 0.035
    b.put(new THREE.BoxGeometry(w, 0.16, w), mat, base, new THREE.Vector3(0, y + 0.08, 0))
    b.put(new THREE.ConeGeometry((w + 0.24) * 0.72, 0.11, 4), dark, base, new THREE.Vector3(0, y + 0.215, 0), new THREE.Euler(0, Math.PI / 4, 0))
    y += 0.27
  }
  b.put(new THREE.CylinderGeometry(0.015, 0.03, 0.26, 6), dark, base, new THREE.Vector3(0, y + 0.1, 0))
}

/**
 * 後岸的松與石組，加上池岸的護岸石：一排越往左越矮的石頭（接著瀑布的石山）、松樹、石塔、地上的青苔、開花的圓杜鵑。
 * shoreSpot：池岸碎石上的隨機一點（護岸石用），找不到回 null。回傳寵物要繞開的圓
 */
function rockGarden(world: THREE.Object3D, layout: RockGarden, shoreSpot: () => [number, number] | null): GardenObstacle[] {
  const obstacles: GardenObstacle[] = []
  const mats = stoneMats()
  const b = new Batch()
  const id = new THREE.Matrix4()
  for (const [x, z, w, h] of layout.range) {
    gardenStone(b, mats, x, 0, z, w, h, w * 0.85, true, 0.1)
    obstacles.push({ x, z, r: w * 0.8 })
  }
  for (const [x, z, size, turn] of layout.pines) {
    gardenPine(b, x, z, size, turn)
    obstacles.push({ x, z, r: 0.25 * size })
  }
  stonePagoda(b, layout.pagoda[0], layout.pagoda[1])
  obstacles.push({ x: layout.pagoda[0], z: layout.pagoda[1], r: 0.35 })
  for (const [x, z, r] of layout.moss) {
    b.put(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.moss[Math.floor(rand(0, 2)) % 2], id, new THREE.Vector3(x, 0, z), undefined, new THREE.Vector3(r, 0.07, r * 0.8))
  }
  // 杜鵑：修成圓球的矮樹，上面點點桃紅的花
  const shrub = [flat(0x4f8a55, 0.95), flat(0x5f9960, 0.95)]
  const bloom = new THREE.MeshStandardMaterial({ color: 0xe35d8f, roughness: 0.6 })
  layout.azaleas.forEach(([x, z, r], i) => {
    b.put(new THREE.IcosahedronGeometry(r, 1), shrub[i % 2], id, new THREE.Vector3(x, r * 0.5, z), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1, 0.72, 1))
    for (let k = 0; k < 9; k++) {
      const a = rand(0, Math.PI * 2)
      const up = rand(0.25, 0.95)
      const out = r * Math.sqrt(1 - up * up * 0.8)
      b.put(new THREE.SphereGeometry(0.045, 6, 5), bloom, id, new THREE.Vector3(x + Math.cos(a) * out, r * 0.5 + up * r * 0.7, z + Math.sin(a) * out))
    }
    obstacles.push({ x, z, r: r * 0.85 })
  })
  // 護岸石：池岸一圈大小不一的小石頭（在水邊的碎石上，陸地的寵物本來就不站；兩棲的要繞開）
  for (let i = 0; i < layout.shoreStones; i++) {
    const p = shoreSpot()
    if (!p) continue
    const r = rand(0.16, 0.3)
    gardenStone(b, mats, p[0], 0, p[1], r, rand(0.16, 0.34), r * rand(0.8, 1.1), i % 3 === 0, 0.3)
    obstacles.push({ x: p[0], z: p[1], r: r * 0.8 })
  }
  b.build(world)
  return obstacles
}

/**
 * 蓋整座賞櫻庭園（ranch-scene.ts 的 build 呼叫）。onLand：這一點是草地（不在水裡、沙灘上，也不貼著小島邊緣）。
 * 回傳寵物要繞開的東西；會動的東西（鹿威し、瀑布）放進 animated，由 ranch-scene.ts 每格呼叫 update
 */
export function buildSakuraGarden(
  world: THREE.Object3D,
  map: RanchMap,
  onLand: (x: number, z: number) => boolean,
  animated: { update(dt: number): void }[],
): GardenObstacle[] {
  const garden = map.garden
  if (!garden) return []
  const obstacles: GardenObstacle[] = []

  const [ox, oz] = garden.shishiOdoshi
  animated.push(new ShishiOdoshi(world, ox, oz))
  // 整組（碎石地、石缽、短柱、筧）當一個圓繞開
  obstacles.push({ x: ox, z: oz, r: 1.0 })

  // 滝石組：石山沿著後岸排開，每隔一段放一個圓；瀑布前面那兩塊立石在淺水裡，也擋一下
  const [fx, fz] = garden.waterfall
  animated.push(new Waterfall(world, fx, fz))
  for (const dx of [-2.4, -1.5, -0.6, 0.6, 1.5, 2.3]) obstacles.push({ x: fx + dx, z: fz + 0.15, r: 0.6 })
  for (const dx of [-0.8, 0.8, -1.6, 1.65]) obstacles.push({ x: fx + dx, z: fz + 0.68, r: 0.45 })
  obstacles.push(
    ...rockGarden(world, garden.rockGarden, () => {
      for (let i = 0; i < 60; i++) {
        const x = rand(0.6, 7.6)
        const z = rand(-6.6, -1.6)
        const d = map.water(x, z)
        if (d >= -0.42 && d <= -0.05 && Math.hypot(x - ox, z - oz) > 1.1) return [x, z]
      }
      return null
    }),
  )

  // 樹：全部合併成幾個網格
  const trees = new Batch()
  const mats = treeMats()
  for (const [x, z, size] of map.trees) {
    sakuraTree(trees, mats, x, z, size)
    obstacles.push({ x, z, r: 0.35 * size })
  }
  const [hx, hz, hs] = garden.hero
  weepingSakura(trees, mats, hx, hz, hs)
  obstacles.push({ x: hx, z: hz, r: 0.6 * hs })
  trees.build(world)

  for (const [x, z] of garden.lanterns) {
    stoneLantern(world, x, z)
    obstacles.push({ x, z, r: 0.3 })
  }

  const { x: bx, z0, z1 } = garden.bridge
  archBridge(world, bx, z0, z1)
  for (const t of [0, 0.5, 1]) obstacles.push({ x: bx, z: z0 + (z1 - z0) * t, r: 0.62 })

  const [tx, tz] = garden.torii
  torii(world, tx, tz)
  for (const sx of [-1, 1]) obstacles.push({ x: tx + sx * 0.66, z: tz, r: 0.2 })
  const [sx, sz] = garden.shrine
  shrine(world, sx, sz)
  obstacles.push({ x: sx, z: sz, r: 0.55 })

  steppingStones(world, garden.path)
  rocksAndShrubs(world, garden.rocks, garden.shrubs)
  for (const [x, z, s] of [...garden.rocks, ...garden.shrubs]) obstacles.push({ x, z, r: s * 0.85 })
  nanohana(world, (x, z) => (onLand(x, z) ? garden.nanohana(x, z) : 0))

  // 地上的落花：照 map.petals 的密度撒在草地上
  const petals = map.petals
  if (petals) {
    petalField(world, 1300, 0.006, () => {
      const x = rand(-8.2, 8.2)
      const z = rand(-8.2, 8.2)
      return Math.random() < petals(x, z) && onLand(x, z) ? [x, z] : null
    })
  }
  // 花筏：漂在水面上的花瓣，靠岸邊比較密，水中央零星幾片
  petalField(
    world,
    520,
    WATER_Y + 0.008,
    () => {
      const x = rand(-8.2, 8.2)
      const z = rand(-8.2, 8.2)
      const d = map.water(x, z)
      if (d < 0.06) return null
      const nearShore = 1 - THREE.MathUtils.smoothstep(d, 0.1, 0.9)
      // 順著水流的幾條花帶
      const streak = 0.5 + 0.5 * Math.sin(x * 1.7 + z * 2.6)
      return Math.random() < 0.12 + 0.6 * nearShore * streak ? [x, z] : null
    },
    2,
  )
  return obstacles
}
