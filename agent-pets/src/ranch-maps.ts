/**
 * 牧場的地形：一塊圓角正方形的小島（等角畫面上是菱形），水的位置看地圖。
 *
 * 2026-11-12 使用者：等角視角（iso-view.ts）的菱形改成正方形，原本透視鏡頭那組長方形地圖都拿掉；
 * 之後照靜態場地預覽（scripts/iso-venue，版本 4）加回中央湖與「中央河 2」：
 * - lake-left 左側海（原本是左側湖；2026-11-12 使用者「左側湖改為左側海，風格是海灘」）：左邊是海（等角畫面上在菱形的左上邊），
 *   海水到小島邊緣，右邊是沙灘再接草地；椰子樹、伸進海裡的木棧橋、小船（beach.ts）
 * - lake-center 火山口湖（原本是中央湖；2026-11-12 使用者「中央湖改為火山口湖」）：靠後面一座隆起的火山，湖在山頂，前面是平地（volcano.ts）
 * - river 中央河：一條中段微微 S 彎的河從菱形的左角流到右角，把陸地分成上下兩塊；陸地的寵物過不去（兩棲的可以涉水）。
 *   上岸那塊是沙地（2026-11-12 使用者），不長草、花，現在是營地（camp.ts）；同一天「重構一版，河改彎（S）一些」
 * - snow 雪地（2026-11-12 使用者「新地貌雪地，用中央湖改，湖形狀要改一下」）：地面是雪、樹是積雪的松樹、有雪人和飄雪（snow.ts）；
 *   湖改成兩個圓湊成的花生形，橫躺在畫面中間。同一天「雪地你重構一版」→ 湖不動，其他重新設計成雪國小屋：
 *   頂角一間亮著燈的小木屋、後緣一整排松林、雪屋、路燈與鏟過雪的小路、白樺
 * - sakura 日式賞櫻（2026-11-12 使用者「河流在右上，左邊有個大櫻花樹」；同一天「櫻花版太醜了，設計個新的」→ 改成池泉庭園）：
 *   水還是在右上、大櫻花還是在左邊。河沿右上邊流進右角前面的池；紅色的太鼓橋在最左邊跨過細細的小溪，通到後岸的鳥居與小祠；
 *   後岸原本一排櫻花，2026-11-13 改成松與石組，池子後岸加了瀑布石組，整圈圍上柵欄；左邊一棵枝垂櫻（樹下原本的紅氈長凳與紅傘，同一天使用者說移除）；飛石小徑從木門到橋頭、池邊一條油菜花、水面上漂著花瓣（sakura.ts）
 *
 * 每張地圖只給一個「水域距離」函式 water(x, z)：> 0 在水裡（離岸多遠）、< 0 在岸上。湖底、沙灘、能不能站都從它算（lake.ts）。
 * 地圖選擇存在 settings.json（electron/ranch-settings.ts），選單（Dock／系統匣）「地圖」切換。
 */
import * as THREE from 'three'

import type { RanchMapId } from '../shared/ranch-protocol'

/**
 * 小島：寬（x）、深（z）、前緣的 z、圓角半徑。
 * 正方形 16.4：寬＋深跟原本的長方形（18.8×14）一樣是 32.8，等角畫面上菱形一樣大，寶可夢在畫面上的大小不變；面積也差不多（269 vs 263）。
 * 中心在原點（前緣 z = 8.2、後緣 -8.2）。
 */
export const RANCH = { w: 16.4, d: 16.4, front: 8.2, corner: 1.4 }
export const HX = RANCH.w / 2
export const HZ = RANCH.d / 2
/** 小島中心的 z */
export const CZ = RANCH.front - HZ
/** 後緣的 z */
export const BACK = RANCH.front - RANCH.d
/** 水域離小島外緣至少這麼遠（中間是沙灘；靠水的那段不圍柵欄） */
const RIM = 0.9
/** 左側海從左邊緣往右多寬（岸邊彎彎的；原本是左側湖的寬度） */
const LAKE_WIDTH = 5.4

/** 點到小島外緣（圓角正方形）的距離，裡面是正的；inset 是外框往內縮多少 */
export function edgeDist(x: number, z: number, inset = 0): number {
  const hx = HX - inset
  const hz = HZ - inset
  const r = Math.max(RANCH.corner - inset, 0.01)
  const qx = Math.abs(x) - (hx - r)
  const qz = Math.abs(z - CZ) - (hz - r)
  return -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r)
}

/** 小島外緣往內縮 inset（負的是往外擴）的圓角正方形上等距的點（x, y＝世界的 x, z） */
export function outline(inset: number, n: number): THREE.Vector2[] {
  const hx = HX - inset
  const hz = HZ - inset
  const r = Math.max(RANCH.corner - inset, 0.01)
  const s = new THREE.Shape()
  s.moveTo(-hx + r, -hz)
  s.lineTo(hx - r, -hz)
  s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false)
  s.lineTo(hx, hz - r)
  s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false)
  s.lineTo(-hx + r, hz)
  s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-hx, -hz + r)
  s.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false)
  return s.getSpacedPoints(n).map((p) => new THREE.Vector2(p.x, p.y + CZ))
}

/** 等角畫面上的座標：u 往右、w 往下（往鏡頭）。鏡頭在右前方（iso-view.ts） */
const U = (x: number, z: number) => (x - z) / Math.SQRT2
const W = (x: number, z: number) => (x + z) / Math.SQRT2

export interface RanchMap {
  id: RanchMapId
  /** 水域距離：> 0 在水裡（離岸多遠） */
  water: (x: number, z: number) => number
  /** 樹（x, z, 大小） */
  trees: [number, number, number][]
  /** 沙地（陸地上不長草的地方）：> 0.5 是沙地；沒有就整片草地 */
  sand?: (x: number, z: number) => number
  /** 地貌：snow 雪地（地面、樹、裝飾換成雪地版，snow.ts）、sakura 日式賞櫻（樹換成櫻花，sakura.ts）、beach 海灘（beach.ts）、volcano 火山（volcano.ts）、moon 月面（moon.ts）、undersea 海底世界（undersea.ts）；沒有就是草地 */
  theme?: 'snow' | 'sakura' | 'beach' | 'volcano' | 'moon' | 'undersea'
  /** 雪人的位置（雪地才有） */
  snowman?: [number, number]
  /** 鏟過雪的小路：0（不在路上）～ 1（路中間）；雪地才有，只改地面顏色，寵物照常走 */
  path?: (x: number, z: number) => number
  /** 雪國小屋的擺設（雪地才有；snow.ts 的 buildSnowVillage 照這個蓋） */
  village?: SnowVillage
  /** 靠水的邊也圍柵欄（賞櫻：水要看起來像圍在庭園裡的池塘）；沒有就是靠水的那一段不圍 */
  fenceWater?: boolean
  /** 木門開在哪一邊：沒有就是正前方（畫面左下邊的中間）；right 是右邊（畫面右下邊的中間） */
  gateSide?: 'right'
  /**
   * 地形與水面用的水域距離（沒有就跟 water 一樣）。左側海用：看起來海水一路到小島邊緣，
   * 而 water（寵物用的）在離邊緣一點點的地方就算岸
   */
  seabed?: (x: number, z: number) => number
  /** 海灘的擺設（左側海才有；beach.ts 的 buildBeach 照這個蓋） */
  beach?: BeachLayout
  /** 椰子樹的樹幹粗幾倍（中央島那棵大椰子樹用）；沒有就是 1 */
  palmGirth?: number
  /** 椰子樹彎的程度乘上多少；沒有就是 1 */
  palmLean?: number
  /** 椰子樹的樣子：chibi 是 Q 版（胖胖一節一節的彎樹幹、幾片寬葉子、兩顆大椰子；中央島用）；沒有就是一般的 */
  palmStyle?: 'chibi'
  /** 沙灘上撒的海星、淺水裡的海星、貝殼、海螺各幾個，以及放大幾倍（中央島用；左側海的在 BeachLayout 那一套裡，比較小） */
  seaLife?: { stars: number; starsInWater: number; shells: number; conches: number; scale: number }
  /** 沙灘上的排球（中央島才有；beach.ts 畫，白底、紅色的手印臉） */
  volleyball?: [number, number]
  /** 沙灘上沖上岸的快遞包裹：x、z、轉角、大小（中央島才有；beach.ts 畫，白紙箱＋紫橘色的帶子，只畫樣子，不放品牌字樣） */
  parcels?: [number, number, number, number][]
  /** 沙灘上半埋在沙裡的黃色橡皮艇：x、z、轉角（船頭朝 local +x；中央島才有；beach.ts 畫） */
  raft?: [number, number, number]
  /** 河畔營地的擺設（中央河才有；camp.ts 的 buildCamp 照這個蓋） */
  camp?: CampLayout
  /** 地面額外的高度（火山口湖的火山）：湖和岸邊要等於 waterLevel；沒有就是平的 */
  elevation?: (x: number, z: number) => number
  /** 水面比平常高多少（火山口湖的湖在山頂）；要同時給 waterOutline */
  waterLevel?: number
  /** 水面的外框（世界的 x, z）；沒有就是整座小島的外框（藏在地形底下） */
  waterOutline?: THREE.Vector2[]
  /** 誰都不能站的地方：火山的山坡、被山擋住的山後面；左側海是棧橋的兩側、盡頭與後面。在水裡的水系不受限 */
  noGo?: (x: number, z: number) => boolean
  /**
   * 海底世界（undersea.ts）：整座島沉在海裡，玻璃罩裡是陸地。dome 是玻璃罩，surface 是海面的高度；
   * float 是水系浮在海床上多高（每隻在這個範圍裡挑一個高度，慢慢上下換，pet-actor.ts）
   */
  undersea?: { dome: { x: number; z: number; r: number; height: number }; surface: number; float: [number, number] }
  /** 月面基地的玻璃罩、水池與罩外的擺設（月面基地才有；moon.ts 的 buildMoonBase 照這個蓋） */
  moonBase?: MoonBase
  /** 整圈都不圍柵欄、也不蓋木門（月面基地：寵物被玻璃罩關著，不需要柵欄） */
  noFence?: boolean
  /**
   * 不屬於任何 session 的 NPC（月面基地罩外的皮皮與皮可西）：品種編號與出場位置。
   * 只在 npcZone 裡活動，不認養、沒有泡泡與名牌、不跟寵物打架；那個品種沒有模型就不出現（npcs.ts）
   */
  npcs?: { species: string; at: [number, number] }[]
  /** NPC 可以站的地方 */
  npcZone?: (x: number, z: number) => boolean
  /** 架在水上的棧橋（左側海才有）：陸地與兩棲的寵物從岸上那一頭走上去，橋下的水誰都不能進 */
  pier?: Pier
  /** 火山口的形狀（火山口湖才有；volcano.ts 照這個上色、擺石頭與噴氣孔） */
  crater?: CraterShape
  /** 草地上的落花密度：0 ～ 1（賞櫻才有；地上撒花瓣、草地色淡淡帶粉紅） */
  petals?: (x: number, z: number) => number
  /** 陸地的寵物不能去的陸地（被水隔開、走不回來的那一塊）；兩棲的涉水過得去，不受限 */
  offLimits?: (x: number, z: number) => boolean
  /** 賞櫻庭園的擺設（賞櫻才有；sakura.ts 的 buildSakuraGarden 照這個蓋） */
  garden?: SakuraGarden
}

/** 月面基地的配置（世界的 x, z） */
export interface MoonBase {
  /** 玻璃罩：圓心與半徑（2026-11-16 使用者「改為一個大罩子」：原本兩個罩子＋通道，改成一個大的） */
  dome: { x: number; z: number; r: number }
  /** 罩頂的高度（罩子是壓扁的半球） */
  height: number
  /**
   * 罩子裡的水池：圓形，在罩子正中央。2026-11-16 使用者先要「水池加大，變成月亮的彎月形狀」，
   * 看過後改「改半圓，跟出口相對」，最後定案「水改圓形，在中央」
   */
  pool: { x: number; z: number; r: number }
  /**
   * 從罩子通到小島邊緣的玻璃通道（2026-11-16 使用者「左邊加上一個通道能到場地邊緣，然後邊緣做一個門」）：
   * 從 from（罩子圓心）沿直線到 to（小島邊緣、門的位置），half 是通道寬的一半。寵物可以走進通道，走到門前為止
   */
  tunnel: { from: [number, number]; to: [number, number]; half: number }
  /** 罩外的旗子與天線 */
  flag: [number, number]
  antenna: [number, number]
}

/** 水池的水域距離：> 0 在水裡（離岸多遠）、< 0 在岸上 */
export function moonPoolDist(base: MoonBase, x: number, z: number): number {
  return base.pool.r - Math.hypot(x - base.pool.x, z - base.pool.z)
}

/** 水池的岸線（世界的 x, z）；grow 是往外多擴多少 */
export function moonPoolOutline(base: MoonBase, n = 64, grow = 0): THREE.Vector2[] {
  const { x, z, r } = base.pool
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return new THREE.Vector2(x + Math.cos(a) * (r + grow), z + Math.sin(a) * (r + grow))
  })
}

/** 到月面基地通道中心線（from → to 那一段）的距離 */
export function moonTunnelDist(base: MoonBase, x: number, z: number): number {
  const [ax, az] = base.tunnel.from
  const [bx, bz] = base.tunnel.to
  const dx = bx - ax
  const dz = bz - az
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1)
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

/** 河畔營地每樣東西放哪裡（世界的 x, z） */
export interface CampLayout {
  /** 帳篷（門朝鏡頭） */
  tent: [number, number]
  /** 營火 */
  fire: [number, number]
  /** 當椅子的木頭（x, z, 轉角） */
  logs: [number, number, number][]
  /** 獨木舟（x, z, 轉角） */
  canoe: [number, number, number]
  /** 小松樹（x, z, 大小） */
  pines: [number, number, number][]
  /** 石頭（x, z, 大小） */
  rocks: [number, number, number][]
}

/** 火山口的形狀 */
export interface CraterShape {
  /** 火山口的中心 */
  x: number
  z: number
  /** 湖面比平地高多少 */
  lift: number
  /** 火口緣最高的地方離湖岸多遠、外坡到離湖岸多遠為止 */
  crest: number
  slopeEnd: number
  /** 火口緣的缺口朝哪裡（弧度） */
  notches: number[]
  /** 這個方向（弧度）的湖有多寬 */
  radiusAt: (a: number) => number
  /** 這個方向的稜線（不算缺口）比平地高多少 */
  rimTop: (a: number) => number
  /** 這個方向的火口緣剩多高（0 = 缺口，1 = 完整） */
  notch: (a: number) => number
}

/**
 * 架在水上的棧橋，沿 x 方向（2026-11-13 使用者「把燈塔移除，那個位置改為海邊會出現的那種木橋，寶可夢可走，下面水下不可走」）。
 * 樣子在 beach.ts 的 pier；能不能站、站多高在 ranch-scene.ts（canStand、deckY、route）
 */
export interface Pier {
  /** 海那一頭的 x */
  x0: number
  /** 岸上那一頭的 x（斜坡從這裡開始往上，寵物只能從這一頭上橋） */
  x1: number
  /** 中心線的 z */
  z: number
  /** 橋面寬的一半 */
  half: number
  /** 橋面比平地高多少 */
  height: number
  /** 岸上那一頭的斜坡多長 */
  ramp: number
}

/** 寵物（的中心）離橋面邊緣至少多遠 */
const PIER_INSET = 0.25
/** 橋面外面這麼寬的一圈誰都不能站。要比 ranch-scene.ts 的 PATH_STEP（0.3）寬，檢查路線時才不會一步跨過去 */
const PIER_SKIRT = 0.4
/** 水系離橋面至少多遠（再加上牠自己的離岸距離），身體才不會鑽到橋下 */
const PIER_GUARD = 0.35

/** 這一點在不在棧橋上寵物能站的那一條：橋面往內縮一點，岸上那一頭是開的 */
export function onPier(p: Pier, x: number, z: number): boolean {
  return x >= p.x0 + PIER_INSET && x <= p.x1 && Math.abs(z - p.z) <= p.half - PIER_INSET
}

/** 橋面在這一點的高度（岸上那一頭是斜坡，從 0 升到 height）；不在橋面上回 null */
export function pierDeckY(p: Pier, x: number, z: number): number | null {
  if (x < p.x0 || x > p.x1 || Math.abs(z - p.z) > p.half) return null
  return p.height * Math.min(1, (p.x1 - x) / p.ramp)
}

/**
 * 棧橋的兩側、盡頭與後面（一路到小島後緣）：誰都不能站。
 * 不擋的話，兩棲的會從水裡直接「跳」上橋面，或從橋面側邊掉下去；只留岸上那一頭可以上下橋
 */
function pierSkirt(p: Pier, x: number, z: number): boolean {
  return x >= p.x0 - PIER_SKIRT && x <= p.x1 && z <= p.z + p.half + PIER_SKIRT && !onPier(p, x, z)
}

/**
 * 水系用：到「橋面＋橋後面那一窄條水」的距離，外面是正的。
 * 橋後面到小島邊緣只剩一點點寬，游不進去，乾脆整條都不算水，才不會有水系出生在那裡卻游不出來
 */
function pierKeepOut(p: Pier, x: number, z: number): number {
  const dx = Math.max(p.x0 - x, x - p.x1)
  const dz = z - (p.z + p.half)
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
}

/** 海灘上每樣東西放哪裡（世界的 x, z） */
export interface BeachLayout {
  /** 拖上沙灘的小船（x, z, 轉角） */
  boat: [number, number, number]
  /** 沙堡 */
  castle: [number, number]
  /** 海灘球 */
  ball: [number, number]
  /** 插在沙裡的衝浪板（x, z, 往旁邊歪多少） */
  boards: [number, number, number][]
  /** 岸邊的石頭（x, z, 大小） */
  rocks: [number, number, number][]
  /** 開紅花的矮樹叢（x, z, 大小） */
  shrubs: [number, number, number][]
  /** 漂流木（x, z, 轉角） */
  driftwood: [number, number, number]
}

/** 雪國小屋裡每樣東西放哪裡（世界的 x, z） */
export interface SnowVillage {
  /** 小木屋的中心（長邊沿 x，門在 +z 那一面） */
  cabin: [number, number]
  /** 雪屋的中心（洞口朝畫面左下，往小島中間；snow.ts 的 IGLOO_ROT） */
  igloo: [number, number]
  /** 路燈 */
  lamps: [number, number][]
  /** 白樺（x, z, 大小） */
  birches: [number, number, number][]
  /** 積雪的石頭（x, z, 大小） */
  rocks: [number, number, number][]
  /** 雪橇（x, z, 轉角） */
  sled: [number, number, number]
}

/** 賞櫻後岸的松與石組（sakura.ts 的 rockGarden 照這個蓋） */
export interface RockGarden {
  /** 一排景石（x, z, 寬, 高）：接著瀑布的石山，越往左越矮 */
  range: [number, number, number, number][]
  /** 修過的松樹（x, z, 大小, 轉角） */
  pines: [number, number, number, number][]
  /** 石塔 */
  pagoda: [number, number]
  /** 地上的青苔（x, z, 半徑） */
  moss: [number, number, number][]
  /** 開花的圓杜鵑（x, z, 大小） */
  azaleas: [number, number, number][]
  /** 池岸撒幾顆護岸石 */
  shoreStones: number
}

/** 賞櫻庭園裡每樣東西放哪裡（世界的 x, z） */
export interface SakuraGarden {
  /** 枝垂櫻（x, z, 大小） */
  hero: [number, number, number]
  /** 石燈籠 */
  lanterns: [number, number][]
  /** 太鼓橋：沿 z 方向跨過小溪，x 是橋的中心線，z0、z1 是兩個橋頭 */
  bridge: { x: number; z0: number; z1: number }
  /** 鳥居（開口朝 z） */
  torii: [number, number]
  /** 小祠（正面朝 +z） */
  shrine: [number, number]
  /** 鹿威し那一組的中心（碎石地、石缽、竹筒沿 x 且開口朝 -x；要放在草地上） */
  shishiOdoshi: [number, number]
  /** 滝石組：瀑布落水口那塊最高的石頭（瀑布朝 +z 落進池子，石山沿 x 往兩邊排開約 2.5） */
  waterfall: [number, number]
  /** 後岸的松與石組、池岸的護岸石 */
  rockGarden: RockGarden
  /** 飛石（踏腳石）小徑經過的點 */
  path: [number, number][]
  /** 景石（x, z, 大小） */
  rocks: [number, number, number][]
  /** 修成圓球的矮樹叢（x, z, 大小） */
  shrubs: [number, number, number][]
  /** 油菜花的密度：0 ～ 1 */
  nanohana: (x: number, z: number) => number
}

/**
 * 左側海（2026-11-12 使用者「左側湖改為左側海，風格是海灘」；id 還是 lake-left，settings.json 裡存的是這個，不改）。
 * 原本是左邊一座湖、外面圍一圈沙灘；現在左邊是海，海水一路到小島邊緣（從側面看得到一截海水的斷面），右邊是沙灘再接草地。
 *
 * 水有兩個函式：
 * - seaBed：看起來的海。地形的高低、顏色、水面都照它，不留邊緣那圈沙灘
 * - seaWater：寵物用的海。離小島邊緣 SEA_EDGE 就算岸，水系才不會游到小島外面；棧橋底下與後面也不算水
 *
 * 2026-11-13 使用者「把燈塔移除，那個位置改為海邊會出現的那種木橋，寶可夢可走，下面水下不可走」：
 * 原本海裡靠頂角有一座小礁島與燈塔，都拿掉了；同一個位置改成從沙灘伸進海裡的木棧橋（SEA_PIER）。
 * - 陸地與兩棲的寵物從岸上那一頭走上去，站在橋面上（ranch-scene.ts 的 canStand、deckY）
 * - 橋下的水誰都不能進：水系被 seaWater 擋在外面，兩棲的被 noGo（橋的兩側、盡頭與後面）擋住
 */
const SEA_EDGE = 0.35
/** 海岸線的 x（隨 z 彎出一個淺淺的海灣） */
const seaShore = (z: number): number => -HX + LAKE_WIDTH + 0.7 * Math.sin(z * 0.42 + 0.6) + 0.25 * Math.sin(z * 1.15 + 2)
/**
 * 棧橋：沿著 z = -6.3 從沙灘（x = -2.1，那裡的海岸線在 -3.2）伸到離小島左緣 1 的地方。
 * 斜坡 1.1 剛好在海岸線升到橋面的高度；海那一頭再往外，寵物本來就不能站（ranch-scene.ts 的 WALK_INSET）
 */
const SEA_PIER: Pier = { x0: -7.2, x1: -2.1, z: -6.3, half: 0.65, height: 0.26, ramp: 1.1 }
const seaBed = (x: number, z: number): number => seaShore(z) - x
/** 棧橋那一塊最低只算到 -0.3：不是水（水系進不去），也不是陸地（陸地的寵物不會把它當草地走上去） */
const seaWater = (x: number, z: number): number => Math.min(seaBed(x, z), edgeDist(x, z) - SEA_EDGE, Math.max(pierKeepOut(SEA_PIER, x, z) - PIER_GUARD, -0.3))
/** 沙灘：海岸線往內約 4.4（邊界彎彎的），再往右才是草地 */
const seaSand = (x: number, z: number): number => (x < seaShore(z) + 4.4 + 0.5 * Math.sin(z * 0.8 + 1.3) ? 1 : 0)
const lakeLeft: RanchMap = {
  id: 'lake-left',
  water: seaWater,
  seabed: seaBed,
  sand: seaSand,
  theme: 'beach',
  pier: SEA_PIER,
  noGo: (x, z) => pierSkirt(SEA_PIER, x, z),
  // 2026-11-12 使用者「左側海，門換到右邊」：木門從正前方（畫面左下邊）移到右邊（畫面右下邊）的中間，原本的位置緊貼著海
  gateSide: 'right',
  // 椰子樹：沙灘上一棵、右上邊（後緣）兩棵。原本八棵，2026-11-12 使用者「樹太多了，刪除一半」；
  // 2026-11-13 使用者「最左邊的樹擋住海上的寶可夢了，移除」→ 沙灘上靠前的那棵（-1.2, 3.3）拿掉，它往海那邊彎，葉子蓋在海面上。
  // 同一天加了棧橋：沙灘上剩的那棵原本在 (-1.5, -4.6)，樹幹和葉子剛好蓋在棧橋上（會擋到橋上的寵物），移到橋頭右邊的後緣
  trees: [
    [0.3, -7.3, 1.05],
    [3.5, -7.4, 0.95],
    [5.7, -7.3, 1.15],
  ],
  beach: {
    boat: [-0.8, 0.5, 0.55],
    castle: [0.5, -2.4],
    ball: [-0.1, 2.3],
    boards: [
      [2.3, -7.1, 0.2],
      [2.8, -7.3, -0.15],
    ],
    // 原本海裡還有一顆（小船往海那邊），2026-11-12 使用者說移除；石頭只放岸上的兩頭
    rocks: [
      [-2.7, 7.0, 0.4],
      [-2.2, -7.2, 0.45],
    ],
    shrubs: [
      [6.7, -5.0, 0.42],
      [4.5, -6.6, 0.36],
    ],
    // 原本在 (-0.6, -6.3)，正好擋在棧橋的橋頭前面，往前移到沙灘上
    driftwood: [-1.9, -4.0, 0.9],
  },
}

/**
 * 火山口湖（原本是中央湖；2026-11-12 使用者「中央湖改為火山口湖」，先在 showcase/crater.html 的預覽頁調過，
 * 選定：活火山、不要岩漿、湖的大小 3.6、火山高度 1.9、往後移 1.2。id 還是 lake-center，settings.json 裡存的是這個，不改）。
 *
 * 一座隆起的火山，湖在山頂（水面比平地高 lift）。火山靠後面（頂角那一側），前面留平地給寵物。
 * - craterWater：水域距離，> 0 在湖裡
 * - craterElevation：地面額外的高度。湖和岸邊是 lift；岸邊往外陡陡地到火口緣（內壁），再沿外坡降回平地
 * - 火口緣後面高、前面矮，湖才不會被前面擋住；正前方和左邊各有一個缺口
 * - 寵物只會貼著平地走，所以整座火山、以及被火山擋住看不到的山後面，都是不能去的地方（craterNoGo）。
 *   水系一出場就在山頂的湖裡；陸地的、兩棲的在山下的平地
 */
const CRATER = {
  /** 火山口的中心 */
  x: -2.0,
  z: -2.1,
  /** 湖的半徑 */
  size: 3.6,
  /** 湖面比平地高多少 */
  lift: 1.9,
  /** 火口緣最高的地方離湖岸多遠 */
  crest: 0.9,
  /** 火口緣比湖面高多少：前面（朝鏡頭）、後面 */
  rimFront: 0.2,
  rimBack: 0.6,
  /** 火口緣的缺口朝哪裡（弧度）：正前方、左邊 */
  notches: [0.8, 2.75],
}
/** 外坡到離湖岸多遠為止 */
const CRATER_SLOPE_END = CRATER.crest + Math.max(1.5, 1.0 + CRATER.lift * 1.1)
/** 鏡頭在右前方（+x、+z），這個方向（弧度）是「正前方」 */
const TOWARD_CAMERA = Math.PI / 4
/** 湖的半徑：大致是圓的，邊緣有一點不規則 */
const craterRadius = (a: number): number => CRATER.size * (1 + 0.07 * Math.sin(3 * a + 0.5) + 0.05 * Math.sin(5 * a + 1.0))
const craterPolar = (x: number, z: number): { r: number; a: number } => {
  const dx = x - CRATER.x
  const dz = z - CRATER.z
  return { r: Math.hypot(dx, dz), a: Math.atan2(dz, dx) }
}
const craterWater = (x: number, z: number): number => {
  const { r, a } = craterPolar(x, z)
  return craterRadius(a) - r
}
/** 這個方向的火口緣剩多高（0 = 缺口，1 = 完整） */
const craterNotch = (a: number): number => {
  let n = 1
  for (const c of CRATER.notches) {
    const da = Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)))
    n = Math.min(n, THREE.MathUtils.smoothstep(da, 0.16, 0.44))
  }
  return n
}
/** 這個方向的稜線（不算缺口）比平地高多少 */
const craterRimTop = (a: number): number => CRATER.lift + CRATER.rimFront + (CRATER.rimBack - CRATER.rimFront) * (0.5 - 0.5 * Math.cos(a - TOWARD_CAMERA))
const craterElevation = (x: number, z: number): number => {
  const { r, a } = craterPolar(x, z)
  const s = r - craterRadius(a)
  if (s < 0.3) return CRATER.lift
  const rough = 0.86 + 0.14 * Math.sin(a * 9 + 1.3) + 0.06 * Math.sin(a * 17)
  const top = CRATER.lift + (craterRimTop(a) - CRATER.lift) * rough * craterNotch(a)
  let y: number
  if (s < CRATER.crest) y = THREE.MathUtils.lerp(CRATER.lift, top, THREE.MathUtils.smoothstep(s, 0.3, CRATER.crest))
  else {
    const t = (s - CRATER.crest) / (CRATER_SLOPE_END - CRATER.crest)
    // 上面陡、下面緩（火山的輪廓）
    y = t >= 1 ? 0 : top * (1 - t) ** 1.5
  }
  // 火山靠到小島邊緣的地方，山坡在邊緣前面收回平地（小島的側面是從平地往下的）
  return y * THREE.MathUtils.smoothstep(edgeDist(x, z), 0.45, 1.5)
}
/**
 * 寵物不能去的地方：火山上（地面不是平的），以及被火山擋住、從鏡頭看不到的山後面
 * （2026-11-12 使用者「後面注意不要讓寶可夢跑過去」）。
 * 「看不到」的算法：從這一點、寵物半身高（0.5）往鏡頭的方向走，鏡頭往下看 30°（iso-view.ts），
 * 路上只要有地面比視線高，就是被擋住。先算成一張 0.15 的格子再往外擴一圈，之後查表（isFree 每秒會問很多次）
 */
const craterNoGo = ((): ((x: number, z: number) => boolean) => {
  const STEP = 0.15
  const n = Math.ceil(RANCH.w / STEP) + 1
  let grid: Uint8Array | null = null
  const build = (): Uint8Array => {
    const raw = new Uint8Array(n * n)
    const k = Math.SQRT1_2
    const rise = Math.tan(THREE.MathUtils.degToRad(30))
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -HX + i * STEP
        const z = BACK + j * STEP
        let blocked = craterElevation(x, z) > 0.04
        for (let t = 0.3; !blocked && t < 12; t += 0.25) blocked = craterElevation(x + t * k, z + t * k) > 0.5 + rise * t
        raw[j * n + i] = blocked ? 1 : 0
      }
    }
    // 往外擴 0.3（寵物有身體的寬度，腳在界線上的話半個身體已經進去了）
    const out = new Uint8Array(n * n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let hit = 0
        for (let dj = -2; dj <= 2 && !hit; dj++) {
          for (let di = -2; di <= 2 && !hit; di++) {
            const jj = j + dj
            const ii = i + di
            if (jj >= 0 && jj < n && ii >= 0 && ii < n && raw[jj * n + ii]) hit = 1
          }
        }
        out[j * n + i] = hit
      }
    }
    return out
  }
  return (x, z) => {
    grid ??= build()
    const i = THREE.MathUtils.clamp(Math.round((x + HX) / STEP), 0, n - 1)
    const j = THREE.MathUtils.clamp(Math.round((z - BACK) / STEP), 0, n - 1)
    return grid[j * n + i] === 1
  }
})()
/** 山頂湖水的外框（比湖岸大一點點，邊緣藏在岸邊底下） */
const craterOutline = Array.from({ length: 96 }, (_, i) => {
  const a = (i / 96) * Math.PI * 2
  const r = craterRadius(a) + 0.04
  return new THREE.Vector2(CRATER.x + Math.cos(a) * r, CRATER.z + Math.sin(a) * r)
})
const lakeCenter: RanchMap = {
  id: 'lake-center',
  water: craterWater,
  trees: [],
  theme: 'volcano',
  elevation: craterElevation,
  waterLevel: CRATER.lift,
  waterOutline: craterOutline,
  noGo: craterNoGo,
  crater: {
    x: CRATER.x,
    z: CRATER.z,
    lift: CRATER.lift,
    crest: CRATER.crest,
    slopeEnd: CRATER_SLOPE_END,
    notches: CRATER.notches,
    radiusAt: craterRadius,
    rimTop: craterRimTop,
    notch: craterNotch,
  },
}

/**
 * 中央河（2026-11-12 使用者「中央河你也重構一版，河改彎（S）一些」→ 重新設計成河畔露營）。
 *
 * 河沿 u（畫面上的水平方向）從左角流到右角，稍微偏上。
 * - 第一版把整條河彎成大 S（上下各彎 3.1），使用者說「太彎了，左右起點跟原本一樣，中間稍微彎一些」→
 *   中心線回到原本那條（-2.6 + 0.5 sin），只在中段疊上一個小小的 S（左邊往上、右邊往下各 0.9），越靠兩頭越淡，
 *   到兩頭（|u| > 8.5）就完全是原本的線
 * - 寬度照使用者之前的要求維持寬的（「河流有點細」）：垂直河岸量是 4.2，跟原本一樣。斜的地方照水流方向修正
 * - 上岸（畫面上方那一塊）整片是沙地（使用者之前指定），現在是營地：帳篷、營火、獨木舟（camp.ts）
 * - 下岸是草地，樹只留四棵
 * - 兩岸不相連，陸地的寵物過不去（兩棲的可以涉水），跟原本一樣
 * 兩頭在小島邊緣留一圈沙灘（直接切穿邊緣的話，左右兩角的泥土側面會凹下去露出斷面）
 */
/** 垂直河岸量的半寬 */
const RIVER_HALF = 2.1
/** 中段的 S 彎多少 */
const RIVER_BEND = 0.9
/** 河的中心線（等角畫面上的 w），u 是畫面上的水平位置 */
const riverLine = (u: number): number =>
  -2.6 + 0.5 * Math.sin(u * 0.45) + RIVER_BEND * Math.sin((u * Math.PI) / 7) * (1 - THREE.MathUtils.smoothstep(Math.abs(u), 5, 8.5))
const riverMid = (x: number, z: number): number => riverLine(U(x, z - CZ))
const riverWater = (x: number, z: number): number => {
  const u = U(x, z - CZ)
  // 中心線在這裡有多斜：斜的地方，上下量到的距離要乘上 cos 才是離河岸的距離
  const tilt = Math.cos(Math.atan((riverLine(u + 0.05) - riverLine(u - 0.05)) / 0.1))
  return Math.min(RIVER_HALF - Math.abs(W(x, z - CZ) - riverLine(u)) * tilt, edgeDist(x, z) - RIM)
}
/** 上岸（河中心線以上，畫面上方）整片是沙地；交界在河裡，看不到 */
const riverSand = (x: number, z: number): number => (W(x, z - CZ) < riverMid(x, z) ? 1 : 0)
const river: RanchMap = {
  id: 'river',
  water: riverWater,
  sand: riverSand,
  // 下岸（草地）的樹：靠前面與右邊的邊緣，只種四棵
  trees: [
    [6.8, 4.6, 0.9],
    [3.0, 7.2, 0.85],
    [-3.6, 7.0, 0.95],
    [7.2, 1.0, 0.8],
  ],
  camp: {
    // 上岸不大（河回到原本的位置之後更小），營地縮在最後面的頂角，前面的沙地留給寵物：
    // 帳篷塞在頂角、營火在帳篷前面、一段當椅子的木頭；獨木舟拖在右邊的河岸上（那裡本來就是寵物不站的岸邊）
    tent: [-6.75, -6.75],
    fire: [-5.4, -5.5],
    logs: [[-4.5, -6.4, -0.6]],
    canoe: [-0.7, -5.8, Math.PI / 4],
    pines: [
      [-7.4, -4.6, 0.9],
      [-4.4, -7.5, 1.0],
    ],
    rocks: [[0.9, -7.3, 0.34]],
  },
}

/** 平滑的 max：兩塊水的交界圓滑地接起來 */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + (h * h * k) / 4
}

/** 一個橢圓的水域距離（中心、半徑、最深處的離岸距離） */
function lobe(x: number, z: number, cx: number, cz: number, rx: number, rz: number, depth: number): number {
  return (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * depth
}

/**
 * 雪地的湖：兩個橢圓接成花生形。左邊那團在畫面左側、右邊那團在畫面右側偏上，中間的腰比較細；陸地繞一圈。
 * 2026-11-12 使用者「雪地的湖連在一起」：原本腰的地方離岸距離是 -0.08（中間隔著一條岸，看起來是兩個湖）→
 * 兩團往中間靠、接縫圓一點，腰的離岸距離約 1.36（水系游得過去，兩團最深處約 3）
 */
const snowWater = (x: number, z: number): number => {
  const zz = z - CZ
  const a = lobe(x, zz, -2.4, 1.0, 3.3, 2.9, 3.0)
  const b = lobe(x, zz, 1.1, -2.6, 3.4, 3.0, 3.2)
  return Math.min(smax(a, b, 3.0), edgeDist(x, z) - RIM)
}
/**
 * 一條小路的「在不在路上」：0（不在）～ 1（路中間），half 是半寬。沿著經過的點拉一條平滑的曲線，量到曲線的距離
 */
function pathField(points: [number, number][], half: number): (x: number, z: number) => number {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)))
  const samples = curve.getSpacedPoints(Math.max(2, Math.round(curve.getLength() / 0.25)))
  return (x, z) => {
    let best = Infinity
    for (const p of samples) best = Math.min(best, (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z))
    return 1 - THREE.MathUtils.smoothstep(Math.sqrt(best), half * 0.55, half)
  }
}
/**
 * 雪地的松林（2026-11-12 重新設計成雪國小屋）：高的都貼著後緣種（左上邊、頂角小木屋後面、右上邊），當背景，不擋前面的寵物，
 * 也盡量不佔寵物能走的地方（離邊緣 0.5 左右，樹幹在柵欄邊）。
 * 左上邊中段（z 從 -0.6 到 3.4）不種：湖在那裡離邊緣最近，能走的地方只剩一條窄窄的走道，小路也從那裡過。
 * 前面只留最下面角落一棵小的
 */
const SNOW_PINES: [number, number, number][] = [
  // 左上邊（北段、南段）
  [-7.7, -3.4, 1.1],
  [-7.75, -1.9, 0.9],
  [-7.7, 4.2, 1.15],
  [-7.75, 5.8, 0.9],
  // 頂角，小木屋旁邊與後面
  [-7.7, -4.7, 1.0],
  [-7.35, -7.35, 1.4],
  [-5.6, -7.75, 1.15],
  [-3.7, -7.7, 1.3],
  // 右上邊
  [-2.0, -7.75, 1.0],
  [-0.4, -7.7, 1.35],
  [1.3, -7.75, 1.05],
  [3.0, -7.7, 1.25],
  [4.4, -7.75, 0.95],
  // 右角，雪屋後面
  [7.5, -7.4, 1.0],
  // 最前面的角落
  [6.7, 6.3, 0.75],
]
const snow: RanchMap = {
  id: 'snow',
  water: snowWater,
  trees: SNOW_PINES,
  theme: 'snow',
  snowman: [4.4, 3.8],
  // 鏟過雪的小路：從木門沿左上邊繞過湖，到小木屋門口
  path: pathField(
    [
      [0, 7.3],
      [-3.2, 6.6],
      [-5.8, 4.9],
      [-6.7, 2.0],
      [-6.7, -1.0],
      [-6.3, -3.2],
      [-5.5, -4.5],
    ],
    0.42,
  ),
  village: {
    // 小木屋塞進頂角、雪屋塞進右角：角落本來就是寵物比較少去的地方
    cabin: [-5.8, -6.0],
    igloo: [6.1, -6.7],
    lamps: [
      [1.4, 6.7],
      [-5.2, 6.2],
      [-3.2, -5.5],
      [6.9, 1.6],
    ],
    // 2026-11-12 使用者在截圖上打叉：左角（-6.5, 6.7）和雪人右邊（6.5, 4.8）那兩棵拿掉，只留右邊這一棵
    birches: [[7.0, -1.2, 1.05]],
    // 石頭放在湖岸的碎石上（那裡寵物本來就不站）
    rocks: [
      [-2.0, 4.25, 0.34],
      [1.6, -5.95, 0.36],
    ],
    sled: [-4.1, -4.75, 0.5],
  },
}

/**
 * 賞櫻的水（2026-11-12 重新設計成池泉庭園）：水從左上邊（頂角附近）流進來，沿著右上邊往右，在右角前面張開成一座池。
 *
 * 2026-11-12 使用者「把橋跟兩端的阻擋物往左上移動、靠近邊緣，騰出來的空間就加大河道」：
 * - 只有最左邊、橋底下那一小段（x < -5.7）是細細的小溪（半寬 0.55）。水系挑的目的地離岸至少 0.65，不會游進去，
 *   所以不會有寵物從橋面穿出來；橋只是裝飾，陸地的寵物也不過橋。
 * - 橋以右加寬成河道（半寬 1.5），一路接到池，水系可以沿著河游。
 */
const brookMid = (x: number): number => CZ - 4.45 + 0.35 * Math.sin(x * 0.6 + 0.3)
const brookHalf = (x: number): number => 0.55 + 0.95 * THREE.MathUtils.smoothstep(x, -5.7, -4.0)
const sakuraWater = (x: number, z: number): number =>
  Math.min(smax(brookHalf(x) - Math.abs(z - brookMid(x)), lobe(x, z - CZ, 4.4, -4.8, 3.5, 2.5, 2.6), 1.0), edgeDist(x, z) - RIM)
/** 河的後面（靠右上邊那一條，橋過去的地方）：陸地的寵物過不去，不要在那裡出場 */
const sakuraFarBank = (x: number, z: number): boolean => z < brookMid(x)
/** 枝垂櫻：畫面左邊，靠左上邊（後緣），樹冠不會擋到前面的寵物 */
const SAKURA_HERO: [number, number, number] = [-5.4, 2.6, 1.0]
/**
 * 小櫻花：左角一棵、最前面的角落一棵。河這一岸不種，橋和河才看得到。
 * 原本後岸（鳥居右邊）還有一排四棵當背景；2026-11-13 使用者看過預覽頁後選「松與石組」，那一排換成松樹與石組（garden.rockGarden）
 */
const SAKURA_TREES: [number, number, number][] = [
  [-7.1, 5.6, 0.85],
  [6.5, 5.9, 0.8],
]
/**
 * 落花的密度：枝垂櫻底下一大片、小櫻花底下一小圈（0 ～ 1，平滑的）。
 * 地上一片片的花瓣照這個機率撒（sakura.ts 的 buildFallenPetals），草地色也照它淡淡帶一點粉紅
 */
const sakuraPetals = (x: number, z: number): number => {
  let density = THREE.MathUtils.smoothstep(4.6 - Math.hypot(x - SAKURA_HERO[0], z - SAKURA_HERO[1]), 0, 3.2)
  for (const [tx, tz, s] of SAKURA_TREES) density = Math.max(density, 0.75 * THREE.MathUtils.smoothstep(1.9 * s - Math.hypot(x - tx, z - tz), 0, 1.1))
  return density
}
/** 油菜花：池的前岸（草地這一側）沿著水邊一條，離沙灘 0.1 ～ 1.1 */
const sakuraNanohana = (x: number, z: number): number => {
  if (sakuraFarBank(x, z) || x < 0.4) return 0
  const d = -sakuraWater(x, z) - 0.65
  return THREE.MathUtils.smoothstep(d, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(d, 0.7, 1.15)) * THREE.MathUtils.smoothstep(x, 0.4, 1.4)
}
const sakura: RanchMap = {
  id: 'sakura',
  water: sakuraWater,
  trees: SAKURA_TREES,
  theme: 'sakura',
  // 2026-11-13 使用者「右邊也用圍欄圍起來，讓右邊的水看起來像池塘」：靠水的邊（池子右邊與後面、小溪左邊）也圍柵欄
  fenceWater: true,
  petals: sakuraPetals,
  offLimits: sakuraFarBank,
  garden: {
    hero: SAKURA_HERO,
    // 入口（木門）兩側各一座、橋頭一座、池邊一座
    lanterns: [
      [-1.5, 6.6],
      [1.5, 6.6],
      [-5.5, -2.6],
      [6.7, -1.2],
    ],
    // 橋、鳥居、小祠都靠左上邊（x ≈ -6.5，邊緣在 -8.2）
    bridge: { x: -6.5, z0: -3.05, z1: -5.55 },
    torii: [-6.5, -6.1],
    shrine: [-6.5, -6.9],
    // 鹿威し（2026-11-13 使用者「日式賞櫻最右邊加上一個…竹子，有水滴在上面」，原本在池子右岸 [7.45, -5.6]）：
    // 同一天「竹子那個你重新設計，然後換去其他地方」→ 移到左邊、太鼓橋橋頭右前方的草地上（河的前岸，離水約 1.5）
    shishiOdoshi: [-2.6, -1.7],
    // 2026-11-13 使用者先看預覽頁，右邊選「瀑布組」、後岸原本四棵櫻花那條地選「松與石組」
    waterfall: [4.7, -7.66],
    rockGarden: {
      range: [
        [1.1, -7.55, 0.5, 1.15],
        [0.2, -7.6, 0.42, 0.8],
        [-1.0, -7.6, 0.55, 1.0],
        [-1.75, -7.5, 0.36, 0.55],
        [-3.9, -7.6, 0.5, 0.85],
        [-4.6, -7.55, 0.36, 0.5],
        [-5.3, -7.5, 0.3, 0.38],
      ],
      pines: [
        [-0.4, -7.15, 1.05, 0.4],
        [-2.7, -7.4, 1.25, 2.2],
        [-4.9, -7.05, 0.9, 4.0],
        // 瀑布右邊、池子右後角的岸上
        [7.45, -6.95, 1.0, 0.6],
      ],
      pagoda: [-1.9, -6.95],
      moss: [
        [-5.0, -7.3, 0.5],
        [-3.3, -7.0, 0.55],
        [-2.3, -7.45, 0.45],
        [-1.2, -7.0, 0.5],
        [0.1, -6.95, 0.45],
        [0.9, -7.2, 0.4],
        [-4.2, -6.95, 0.4],
      ],
      azaleas: [
        [-3.6, -6.85, 0.36],
        [-3.1, -6.75, 0.26],
        [0.55, -6.8, 0.34],
        [-5.2, -6.8, 0.28],
      ],
      shoreStones: 10,
    },
    // 飛石：從木門彎到橋頭
    path: [
      [0, 7.0],
      [-0.6, 4.6],
      [-1.7, 2.2],
      [-3.5, 0.1],
      [-5.5, -1.4],
      [-6.5, -2.5],
    ],
    rocks: [
      [2.2, -1.6, 0.42],
      [5.7, -1.7, 0.36],
      [-7.25, -2.4, 0.34],
      [-7.0, 4.2, 0.32],
    ],
    shrubs: [
      [1.5, -1.3, 0.42],
      [-4.5, -2.1, 0.4],
      [7.0, -0.4, 0.38],
      [-7.2, 0.4, 0.36],
    ],
    nanohana: sakuraNanohana,
  },
}

/**
 * 中央島（2026-11-13 新增的第六張地圖）：四面環海的小沙島，水在外圍，水系繞著島游。
 *
 * 使用者的原話，照順序：「來中央島，水在外圍」→（先試過賞楓風格）「場地外圈不要有土，像是左邊海一樣，土地層直接是水」
 * →「楓葉樹不適合海洋風，換成椰子樹」→ 看過預覽頁後選一棵大椰子樹那版，「樹粗一些，只要沙地，放一顆威爾森排球」。
 * - 整座島都是沙，沒有草地（isletSand 永遠是 1）
 * - 只有一棵大椰子樹，往畫面左邊彎：樹幹是一般的樣子（粗一點），葉子和椰子是 Q 版的寬葉子、兩顆大椰子（palmStyle: 'chibi'）
 * - 沙灘上撒一些比較大的海星、貝殼、海螺（seaLife）
 * - 沙灘上一顆排球，白底、紅色的手印臉（volleyball；只畫樣子，不放品牌字樣）
 * - 海跟左側海同一套（theme: 'beach'、seabed）：水一路到小島邊緣，四周沒有柵欄也沒有木門
 */
/** 島的岸線：大致是圓的，邊緣彎彎的不規則 */
const isletRadius = (a: number): number => 5.25 + 0.35 * Math.sin(a * 3 + 0.6) + 0.22 * Math.sin(a * 5 + 2.1)
/** 看起來的海：島外面都是水，一路到小島邊緣 */
const isletBed = (x: number, z: number): number => Math.hypot(x, z - CZ) - isletRadius(Math.atan2(z - CZ, x))
/** 寵物用的海：離小島邊緣 SEA_EDGE 就算岸，水系才不會游到小島外面 */
const isletWater = (x: number, z: number): number => Math.min(isletBed(x, z), edgeDist(x, z) - SEA_EDGE)
const islet: RanchMap = {
  id: 'islet',
  water: isletWater,
  seabed: isletBed,
  sand: () => 1,
  theme: 'beach',
  // 2026-11-13 使用者「樹改稍微彎，然後略矮一點點，然後往左下移，避免樹葉太高」：原本在 (-1.6, -1.6)、大小 2.0、彎度跟左側海的一樣；
  // 往畫面左下（+z）移、矮一點、只微微彎，樹冠就不會頂到畫面上緣。樹幹的粗細維持原樣（大小變小，所以 palmGirth 調高）
  // 同一天使用者貼了一張 Q 版椰子樹的圖：「椰子樹這樣 Q 版彎，然後加一些貝殼、海星佈景」→ 樹換成 Q 版（palmStyle），沙灘上撒海星、貝殼、海螺（seaLife）
  trees: [[-2.2, 0.3, 1.7]],
  palmStyle: 'chibi',
  seaLife: { stars: 3, starsInWater: 5, shells: 9, conches: 3, scale: 1.7 },
  volleyball: [1.0, -0.3],
  // 2026-11-13 使用者「在島上新增兩個 FedEx 包裹」：排球右邊的沙灘上兩個沖上岸的包裹，一大一小、歪歪的半陷在沙裡
  parcels: [
    [3.0, -1.0, 0.5, 1.5],
    [1.9, -2.6, -0.35, 1.2],
  ],
  // 2026-11-13 使用者「中央島加上一個側翻的黃色橡皮艇」→「一半在沙子裡，前面有角度的那種款式」：島的左前方、靠岸邊，船頭朝畫面右邊
  raft: [-0.6, 3.3, 0.6],
}

/**
 * 月面基地（2026-11-16 新增的第七張地圖）。使用者的原話：
 * 「新增一個地圖：月面基地。土地是月面，然後有兩個半圓形玻璃罩罩著場地，中間有通道，一個半圓是水。
 *   玻璃罩外面放兩個皮皮跟 1 隻皮可西當 NPC，隨機動作」
 * 同一天改版：「1. 改為一個大罩子 2. 月面能不能坑洞有凹凸起伏 3. 能保證新生成的寶可夢在罩子裡？」
 *
 * - 一個大玻璃罩罩住小島中間，罩子裡是平的地板，正中央一座圓形水池
 * - 寵物只能待在罩子裡（noGo 把外面擋掉）；出生點、閒逛的目的地、被擠到時拉回去的位置都照 noGo，所以都在罩子裡
 * - 罩外是月面：整片緩緩起伏，四個角與幾條邊上有隕石坑（坑底往下凹、坑緣隆起一圈）；那裡是 NPC 的地方（npcZone）
 * - 整圈不圍柵欄、沒有木門（noFence）
 * - 罩子往畫面左下接一段玻璃通道，一路通到小島邊緣，盡頭是一扇門（使用者「左邊加上一個通道能到場地邊緣，然後邊緣做一個門」）；寵物可以走進通道
 * - 罩外 10 隻皮皮、2 隻皮可西（使用者「皮皮改 10 隻、皮可西 2 隻」），再混一隻胖丁（「混一隻胖丁進去當 NPC」）
 */
/**
 * 通道的終點：從罩子圓心往 +z（畫面左下那條邊）一路走到離小島邊緣 0.12 的地方，門就蓋在那裡。
 * 原本通往菱形最左邊的角，但門朝左、從鏡頭看只剩側邊一條線；改成左下那條邊，門斜斜朝著鏡頭，看得到門板和圓窗
 */
const MOON_DOOR: [number, number] = (() => {
  const ux = 0
  const uz = 1
  let t = 6
  while (edgeDist(ux * t, CZ + uz * t) > 0.12) t += 0.02
  return [ux * t, CZ + uz * t]
})()
const MOON_BASE: MoonBase = {
  dome: { x: 0, z: 0, r: 6.0 },
  height: 3.2,
  // 圓形水池在罩子正中央（使用者「水改圓形，在中央」），四周留一圈陸地給寵物走
  pool: { x: 0, z: 0, r: 3.0 },
  tunnel: { from: [0, 0], to: MOON_DOOR, half: 0.85 },
  flag: [3.6, 6.4],
  antenna: [-6.5, -3.2],
}
/** 到玻璃罩的距離：< 0 在罩子裡 */
const moonDome = (x: number, z: number): number => Math.hypot(x - MOON_BASE.dome.x, z - MOON_BASE.dome.z) - MOON_BASE.dome.r
/** 到通道玻璃的距離：< 0 在通道裡 */
const moonTunnel = (x: number, z: number): number => moonTunnelDist(MOON_BASE, x, z) - MOON_BASE.tunnel.half
const moonWater = (x: number, z: number): number => moonPoolDist(MOON_BASE, x, z)
/** 隕石坑（x, z, 半徑）：都在罩外；坑緣（1.35 倍半徑）離罩子與小島邊緣都留一點距離 */
const MOON_CRATERS: [number, number, number][] = [
  [5.9, 5.6, 1.0],
  [-5.8, -5.9, 1.0],
  [5.8, -5.9, 0.8],
  [7.1, 0.6, 0.4],
  [-0.8, -7.1, 0.4],
  [-5.9, 5.7, 0.75],
  [-7.1, -0.9, 0.35],
]
/**
 * 地面的高低：罩子裡是平的；罩外整片緩緩起伏，隕石坑往下凹、坑緣隆起一圈。
 * 靠近罩子與小島邊緣的地方慢慢收回 0（罩子的底座貼地、小島側面是從平地往下切的）
 */
const moonElevation = (x: number, z: number): number => {
  const smooth = THREE.MathUtils.smoothstep
  const fade = smooth(Math.min(moonDome(x, z), moonTunnel(x, z)), 0.15, 1.1) * smooth(edgeDist(x, z), 0.2, 1.0)
  if (fade <= 0) return 0
  // 起伏：兩層不同大小的波，大的是緩坡、小的是小土丘
  let y = 0.09 * Math.sin(x * 1.1 + z * 0.35) * Math.sin(z * 0.9 - x * 0.55) + 0.045 * Math.sin(x * 2.9 - z * 2.1 + 1.3) * Math.sin(z * 2.6 + x * 1.7)
  for (const [cx, cz, r] of MOON_CRATERS) {
    const t = Math.hypot(x - cx, z - cz) / r
    const k = Math.min(1, r)
    // 坑：中間深、往外變淺，到 t = 1 剛好回到 0；坑緣：t 在 0.85～1.35 之間隆起一圈
    if (t < 1) y -= 0.34 * k * (1 - t * t) ** 1.5
    if (t > 0.85 && t < 1.35) y += 0.13 * k * Math.sin(((t - 0.85) / 0.5) * Math.PI)
  }
  return y * fade
}
const moon: RanchMap = {
  id: 'moon',
  water: moonWater,
  trees: [],
  theme: 'moon',
  moonBase: MOON_BASE,
  noFence: true,
  elevation: moonElevation,
  // 水面只鋪水池那一片：整座小島都鋪的話，隕石坑比水面低，坑裡會冒出水來
  waterOutline: moonPoolOutline(MOON_BASE, 64, 0.1),
  // 寵物只能在罩子和通道裡（離玻璃 0.5 以上；通道窄，只離 0.4）
  noGo: (x, z) => moonDome(x, z) > -0.5 && moonTunnel(x, z) > -0.4,
  // 2026-11-16 使用者「皮皮改 10 隻、皮可西 2 隻」：散在罩外一圈，避開通道、旗子和天線
  npcs: [
    ...([
      [6.2, 3.6],
      [6.9, -1.5],
      [6.4, 6.2],
      [2.0, 7.2],
      [-2.5, 7.1],
      [-7.2, 2.0],
      [-6.9, -1.5],
      [-4.2, -6.4],
      [0.5, -7.2],
      [4.6, -6.0],
    ] as [number, number][]).map((at) => ({ species: '035', at })),
    { species: '036', at: [3.4, -6.6] },
    { species: '036', at: [-6.2, -5.4] },
    // 2026-11-16 使用者「混一隻胖丁進去當 NPC」：混在右上那群皮皮裡
    { species: '039', at: [5.4, -4.4] },
  ],
  npcZone: (x, z) => moonDome(x, z) > 0.55 && moonTunnel(x, z) > 0.55 && edgeDist(x, z) > 0.8,
}

/**
 * 海底世界（2026-11-17 新增的第八張地圖）。使用者的原話：「海底世界……跟月面相反，中間一個罩子，裡面是陸地」，
 * 高度的做法選了「A：浮在不同高度」（每隻水系挑一個離海床的高度慢慢上下換，不做真正的 3D 游泳）。
 *
 * - 整座島沉在海裡：罩子外面一路是海到小島邊緣（seabed），海面在 surface 那麼高（undersea.ts 畫半透明的海面與四周的水牆）
 * - 中間一個玻璃罩，裡面是陸地：草地、三棵樹、花草；陸地的寵物只待在罩子裡（noGo）
 * - 兩棲的在這張地圖算水系，放到罩外的海裡（使用者「水陸兩用的也判斷丟到水中」；pet-actor.ts 的建構子）
 * - 水系在罩外的海裡游，浮在海床上不同高度，海床上的影子看得出浮多高
 * - 罩外的海床：細沙、珊瑚、海草（會晃）、礁石、沉在海底的寶箱、往上冒的氣泡、繞著罩子游的小魚群、從海面斜照下來的光（undersea.ts）
 * - 整圈不圍柵欄（noFence）
 */
// 海面不能太高：等角畫面上，後面那一角的海面會超出視窗上緣（3.4 會切到、2.75 剛好貼著上緣）
// 2026-11-17 使用者「陸地再大一些」：罩子半徑 4.5 → 5.4（罩外的海還留兩格左右寬，水系游得開）
const UNDERSEA = { dome: { x: 0, z: 0, r: 5.4, height: 2.0 }, surface: 2.5, float: [0.3, 1.3] as [number, number] }
/** 看起來的海：罩子外面都是海，一路到小島邊緣（離玻璃 0.3 才開始算水，玻璃底座那圈是沙） */
const underseaBed = (x: number, z: number): number => Math.hypot(x - UNDERSEA.dome.x, z - UNDERSEA.dome.z) - (UNDERSEA.dome.r + 0.3)
const undersea: RanchMap = {
  id: 'undersea',
  // 寵物用的海：離小島邊緣 SEA_EDGE 就算岸，水系才不會游到小島外面
  water: (x, z) => Math.min(underseaBed(x, z), edgeDist(x, z) - SEA_EDGE),
  seabed: underseaBed,
  trees: [
    [-1.8, -1.2, 0.85],
    [1.6, 1.9, 0.75],
    [2.6, -2.0, 0.7],
  ],
  theme: 'undersea',
  undersea: UNDERSEA,
  noFence: true,
  // 陸地的寵物只能在罩子裡（離玻璃 0.45 以上）；水系（含這張地圖的兩棲）在海裡不受限
  noGo: (x, z) => Math.hypot(x - UNDERSEA.dome.x, z - UNDERSEA.dome.z) > UNDERSEA.dome.r - 0.45,
}

export const MAPS: Record<RanchMapId, RanchMap> = { 'lake-left': lakeLeft, 'lake-center': lakeCenter, river, snow, sakura, islet, moon, undersea }
export const DEFAULT_MAP: RanchMapId = 'lake-left'
