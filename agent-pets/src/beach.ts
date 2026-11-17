/**
 * 左側海（海灘）地圖的東西（2026-11-12 使用者「左側湖改為左側海，風格是海灘」；ranch-maps.ts 的 lake-left）：
 * - 椰子樹：彎彎的樹幹、頂端一圈往下垂的大葉子、幾顆椰子。樹幹細、葉子在高處，站在沙灘中間也不太擋寵物（只種三棵：使用者嫌多，最左邊那棵又擋到海上的寵物）
 * - 木棧橋：從沙灘伸進海裡，寵物可以走上去（2026-11-13 使用者「把燈塔移除，那個位置改為海邊會出現的那種木橋」；
 *   原本這裡是小礁島上的紅白燈塔）。位置與大小在 ranch-maps.ts 的 SEA_PIER
 * - 沙灘上：拖上岸的小船、沙堡、海灘球、插在沙裡的衝浪板、漂流木、海星與貝殼
 * - 岸邊的石頭、草地那一側開紅花的矮樹叢
 * - 中央島（ranch-maps.ts 的 islet）也用這個檔案：一棵 Q 版的大椰子樹（map.palmStyle）、一顆排球（map.volleyball）、兩個沖上岸的快遞包裹（map.parcels）、一艘半埋在沙裡的黃色橡皮艇（map.raft）、比較大的海星貝殼海螺（map.seaLife）
 *
 * 都用程式產生，不用圖檔。每樣東西的位置在 ranch-maps.ts 的 BeachLayout。
 * 沙、海水、海底的顏色與浪花在 ranch-scene.ts 的 buildIsland（照 map.theme 換配色）。
 */
import * as THREE from 'three'

import { Batch, flat, placed, rand } from './batch'
import { WATER_Y } from './lake'
import { pierDeckY, type Pier, type RanchMap } from './ranch-maps'

/**
 * 海灘的配色（ranch-scene.ts 的 buildIsland 用）：草地（亮一點的熱帶綠）、沙（乾的兩種深淺）、岸邊的乾沙與濕沙、
 * 海底（淺的地方透出沙色的青綠、深的地方是藍）、小島側面的沙土
 */
export const BEACH_GROUND = {
  grass: 0x6aa85a,
  grass2: 0x78b464,
  tuft: 0x5c9a52,
  sand: 0xf1e0b4,
  sand2: 0xe8d4a2,
  shore: 0xf3e6c2,
  shoreWet: 0xd9c595,
  bedShallow: 0x8fdccf,
  bedDeep: 0x1f73ad,
  cliff: 0xc9a56c,
  foam: 0xffffff,
}
export const BEACH_WATER = 0x3cbfe0
export const BEACH_WATER_OPACITY = 0.56

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface BeachObstacle {
  x: number
  z: number
  r: number
}

interface PalmMats {
  trunk: THREE.Material
  leaf: THREE.Material[]
  nut: THREE.Material
}

/**
 * 椰子樹：樹幹沿著一條往 lean 方向彎的曲線分成幾段，頂端八片葉子，每片由根部往外先翹起再垂下去。高約 2.9 × size
 */
function palm(b: Batch, mats: PalmMats, x: number, z: number, size: number, lean: THREE.Vector2, girth = 1): void {
  const base = placed(x, z, 0, size)
  const at = (t: number) => new THREE.Vector3(lean.x * 0.95 * t * t, 2.75 * t, lean.y * 0.95 * t * t)
  const segments = 6
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments
    const t1 = (i + 1) / segments
    b.rod(mats.trunk, base, at(t0), at(t1), (0.14 - t0 * 0.055) * girth, (0.14 - t1 * 0.055) * girth, 7)
  }
  const top = at(1)
  const fronds = 8
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rand(-0.2, 0.2)
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
    let p = top.clone()
    const pieces = 4
    for (let k = 0; k < pieces; k++) {
      // 由根部到葉尖：先往上翹 0.45，再一段段往下垂到 -1.0
      const pitch = 0.45 - k * 0.48 + rand(-0.06, 0.06)
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), Math.sin(a) * Math.cos(pitch))
      const len = 0.46
      const width = 0.36 - k * 0.085
      const up = new THREE.Vector3().crossVectors(side, dir).normalize()
      const mid = p.clone().addScaledVector(dir, len / 2)
      const m = new THREE.Matrix4().makeBasis(dir, up, side).setPosition(mid)
      b.add(new THREE.BoxGeometry(len * 1.06, 0.028, width), mats.leaf[(i + k) % 2], m.premultiply(base))
      p = p.addScaledVector(dir, len)
    }
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + rand(0, 0.5)
    b.put(new THREE.SphereGeometry(0.1, 8, 6), mats.nut, base, top.clone().add(new THREE.Vector3(Math.cos(a) * 0.14, -0.14, Math.sin(a) * 0.14)))
  }
}

/**
 * 木棧橋：一片片橫鋪的木板（深淺三種、長短稍微不齊）、底下兩根縱樑、每隔一段一對插進海底的木樁（樁頭高出橋面一點），
 * 岸上那一頭是貼著沙灘的斜坡。後側（畫面上方）的樁頭之間拉一條垂垂的麻繩；前側不拉，才不會擋到橋上的寵物。
 * bedY：這一點的海底高度（木樁要插多深）
 */
function pier(world: THREE.Object3D, p: Pier, bedY: (x: number, z: number) => number): void {
  const b = new Batch()
  const id = new THREE.Matrix4()
  const planks = [flat(0xb89468, 0.95), flat(0xa9855a, 0.95), flat(0xc4a076, 0.95)]
  const beam = flat(0x86663f, 1)
  const post = flat(0x6f5438, 1)
  const cap = flat(0x937551, 1)
  const rope = flat(0xdccfa8, 1)
  const top = (x: number) => pierDeckY(p, x, p.z) ?? 0
  /** 斜坡在哪裡接上平的橋面 */
  const landing = p.x1 - p.ramp
  const slope = -Math.atan2(p.height, p.ramp)

  // 木板：沿著橋一片片鋪過去，斜坡上的跟著斜
  const step = 0.21
  for (let x = p.x0 + step / 2; x < p.x1 - 0.02; x += step) {
    const width = p.half * 2 + rand(-0.04, 0.08)
    b.put(new THREE.BoxGeometry(step - 0.025, 0.05, width), planks[Math.floor(rand(0, 3)) % 3], id, new THREE.Vector3(x, top(x) - 0.025, p.z + rand(-0.02, 0.02)), new THREE.Euler(0, 0, x > landing ? slope : 0))
  }

  // 縱樑：橋面底下兩根，斜坡那一段順著斜下去到沙灘
  for (const side of [-1, 1]) {
    const z = p.z + side * (p.half - 0.18)
    const under = p.height - 0.1
    b.rod(beam, id, new THREE.Vector3(p.x0 + 0.05, under, z), new THREE.Vector3(landing, under, z), 0.06, 0.06, 4)
    b.rod(beam, id, new THREE.Vector3(landing, under, z), new THREE.Vector3(p.x1 - 0.1, -0.06, z), 0.06, 0.06, 4)
  }

  // 木樁：平的那一段每隔約 1 一對，從海底插上來，樁頭高出橋面；最外面那一對高一點，纏一圈麻繩（繫船柱）
  const count = Math.max(2, Math.round((landing - p.x0) / 1.0) + 1)
  const backTops: THREE.Vector3[] = []
  for (let i = 0; i < count; i++) {
    const x = p.x0 + 0.12 + ((landing - p.x0 - 0.12) * i) / (count - 1)
    const rise = i === 0 ? 0.36 : 0.2
    for (const side of [-1, 1]) {
      const z = p.z + side * (p.half + 0.02)
      const foot = Math.min(bedY(x, z), 0) - 0.12
      const head = p.height + rise
      b.put(new THREE.CylinderGeometry(0.07, 0.085, head - foot, 8), post, id, new THREE.Vector3(x, (head + foot) / 2, z))
      b.put(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 8), cap, id, new THREE.Vector3(x, head + 0.017, z))
      if (i === 0) b.put(new THREE.CylinderGeometry(0.086, 0.086, 0.09, 8), rope, id, new THREE.Vector3(x, head - 0.12, z))
      if (side < 0) backTops.push(new THREE.Vector3(x, p.height + 0.15, z))
    }
    // 每對木樁之間一根橫樑，托著縱樑
    b.put(new THREE.BoxGeometry(0.09, 0.08, p.half * 2), beam, id, new THREE.Vector3(x, p.height - 0.2, p.z))
  }

  // 麻繩：後側的樁頭之間，中間垂下去一點
  for (let i = 0; i + 1 < backTops.length; i++) {
    const from = backTops[i]
    const to = backTops[i + 1]
    const pieces = 5
    for (let k = 0; k < pieces; k++) {
      const at = (t: number) => from.clone().lerp(to, t).add(new THREE.Vector3(0, -0.09 * 4 * t * (1 - t), 0))
      b.rod(rope, id, at(k / pieces), at((k + 1) / pieces), 0.016, 0.016, 5)
    }
  }
  b.build(world)

  // 橋下的影子：水面上一片淡淡的深色，橋才不會像飄在海上
  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(landing - p.x0, p.half * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x0b3350, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  shade.position.set((landing + p.x0) / 2, WATER_Y + 0.004, p.z)
  shade.renderOrder = 2
  world.add(shade)
}

/**
 * 排球（中央島，2026-11-13 使用者「放一顆威爾森排球」）：一顆有點舊的白排球，朝鏡頭那一面是紅色的手印臉——
 * 手掌是一塊紅、上面五根手指，掌心留出兩個眼睛和一張嘴。只畫樣子，不放品牌字樣
 */
function volleyball(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  // 臉朝鏡頭（鏡頭在 +x、+z）
  const base = placed(x, z, Math.PI / 4)
  // 比真的排球大一些：照實際比例在整座小島的畫面上只剩一個小點
  const r = 0.34
  const white = new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.75 })
  const red = new THREE.MeshStandardMaterial({ color: 0xa9281f, roughness: 0.8 })
  b.put(new THREE.SphereGeometry(r, 18, 14), white, base, new THREE.Vector3(0, r, 0))
  // 球面上、往上 up 弧度、往旁邊 side 弧度的一點（0, 0 是正對鏡頭）
  const on = (up: number, side: number, out = 1.0) => new THREE.Vector3(Math.sin(side) * Math.cos(up), Math.sin(up), Math.cos(side) * Math.cos(up)).multiplyScalar(r * out).add(new THREE.Vector3(0, r, 0))
  const patch = (up: number, side: number, w: number, h: number, mat: THREE.Material, out = 1.0) =>
    b.put(new THREE.SphereGeometry(1, 10, 8), mat, base, on(up, side, out), new THREE.Euler(-up, side, 0), new THREE.Vector3(w, h, 0.012))
  patch(0.05, 0, 0.2, 0.185, red, 0.97)
  for (let i = 0; i < 5; i++) patch(0.62 + (i === 2 ? 0.08 : i === 0 || i === 4 ? -0.12 : 0), (i - 2) * 0.3, 0.043, 0.108, red, 0.97)
  for (const side of [-0.22, 0.22]) patch(0.18, side, 0.046, 0.054, white, 1.0)
  patch(-0.2, 0, 0.093, 0.028, white, 1.0)
  b.build(world)
}

/**
 * 快遞包裹（中央島，2026-11-13 使用者「在島上新增兩個 FedEx 包裹」）：白色紙箱，上半圈一條紫色帶子、底下一條細橘線，
 * 頂面貼一張白色託運單、中間一條封箱膠帶。像沖上岸的樣子：稍微歪、底部陷進沙裡一點。
 * 只用配色讓人聯想，不放品牌字樣或標誌（這是要開源的 repo，不要放別人的商標；排球也是同樣的做法）。
 * size 1 時約 0.56×0.42×0.4
 */
function parcel(world: THREE.Object3D, x: number, z: number, rot: number, size: number): void {
  const b = new Batch()
  const w = 0.56
  const h = 0.42
  const d = 0.4
  // 歪一點，底部陷進沙裡 0.05
  const base = placed(x, z, rot, size).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.06, 0, 0.1)))
  const box = new THREE.BoxGeometry(1, 1, 1)
  const card = new THREE.MeshStandardMaterial({ color: 0xf2eee6, roughness: 0.85 })
  const purple = flat(0x4d148c, 0.7)
  const orange = flat(0xff6a13, 0.7)
  const label = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
  const tape = new THREE.MeshStandardMaterial({ color: 0xc8a46a, roughness: 0.5 })
  const y0 = h / 2 - 0.05
  b.put(box, card, base, new THREE.Vector3(0, y0, 0), undefined, new THREE.Vector3(w, h, d))
  // 繞一圈的帶子：比箱子大一點點，只露出側面
  b.put(box, purple, base, new THREE.Vector3(0, y0 + h * 0.22, 0), undefined, new THREE.Vector3(w + 0.006, h * 0.26, d + 0.006))
  b.put(box, orange, base, new THREE.Vector3(0, y0 + h * 0.05, 0), undefined, new THREE.Vector3(w + 0.006, h * 0.06, d + 0.006))
  // 頂面：封箱膠帶沿長邊、託運單偏一邊
  b.put(box, tape, base, new THREE.Vector3(0, y0 + h / 2 + 0.002, 0), undefined, new THREE.Vector3(w + 0.008, 0.006, 0.09))
  b.put(box, label, base, new THREE.Vector3(-w * 0.2, y0 + h / 2 + 0.005, d * 0.22), new THREE.Euler(0, 0.08, 0), new THREE.Vector3(0.2, 0.006, 0.13))
  b.build(world)
}

/**
 * 沖上岸的黃色橡皮艇（中央島）：
 * - 2026-11-13 使用者「中央島加上一個側翻的黃色橡皮艇」→ 先做成一圈橢圓的管子立在沙上，
 *   使用者看了說「怪怪的，試試看能不能一半在沙子裡，然後要是前面有角度的那種款式，這樣 /-\」
 * - 現在：一般充氣艇的樣子——兩條側管、船頭收成尖角斜斜往上翹（/-\ 的那個角度）、船尾也微微翹起；
 *   正面朝上、往一側歪一點，管子一半埋在沙裡（中心線在地面），艇裡積著沙，翹起來的船頭露在外面。
 *   也試過整艘倒扣的版本：艇底朝上只看得到一塊平平的黃色，船頭也埋進沙裡，認不出是橡皮艇，所以沒用
 * 長約 1.9
 */
function raft(world: THREE.Object3D, x: number, z: number, rot: number, groundY: number): void {
  const b = new Batch()
  const r = 0.15
  const W = 0.36
  const LEAN = 0.18
  // 往一側歪一點；管子中心線在地面高度，等於一半埋在沙裡
  const base = placed(x, z, rot).multiply(new THREE.Matrix4().makeTranslation(0, groundY + 0.01, 0)).multiply(new THREE.Matrix4().makeRotationX(LEAN))
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.55 })
  const floor = new THREE.MeshStandardMaterial({ color: 0xd9a514, roughness: 0.7 })
  const rope = flat(0x4a4038, 0.9)
  // 正放時的樣子（長軸是 x、船頭在 +x、y 朝上），再整組照 base 擺好：一條側管的折線，船頭往上翹、往中間收
  const side = (s: number): THREE.Vector3[] => [
    // 斜坡要拉得夠長才看得出角度：太短（x 只走 0.2）在等角畫面上只是一個小凸起
    new THREE.Vector3(-1.0, 0.24, s * W * 0.6),
    new THREE.Vector3(-0.6, 0, s * W),
    new THREE.Vector3(0.25, 0, s * W),
    new THREE.Vector3(0.8, 0.32, s * W * 0.6),
    new THREE.Vector3(1.15, 0.56, 0),
  ]
  const ball = new THREE.SphereGeometry(r, 10, 8)
  for (const s of [-1, 1]) {
    const pts = side(s)
    for (let i = 0; i < pts.length - 1; i++) b.rod(yellow, base, pts[i], pts[i + 1], r, r, 10)
    for (const p of pts) b.put(ball, yellow, base, p)
    // 拉繩：沿著管子外側上方
    for (let i = 1; i < 3; i++) b.rod(rope, base, pts[i].clone().add(new THREE.Vector3(0, r * 0.55, s * r * 0.75)), pts[i + 1].clone().add(new THREE.Vector3(0, r * 0.55, s * r * 0.75)), 0.016, 0.016, 4)
  }
  // 船尾：兩條側管的尾端接起來
  b.rod(yellow, base, side(-1)[0], side(1)[0], r, r, 10)
  // 艇底：平的那段埋在沙裡看不到，只做船頭翹起來那一片
  b.put(new THREE.BoxGeometry(0.66, 0.03, W * 1.6), floor, base, new THREE.Vector3(0.52, 0.16 - r * 0.4, 0), new THREE.Euler(0, 0, 0.53))
  b.build(world)
}

/**
 * Q 版椰子樹（中央島，2026-11-13 使用者貼了參考圖「椰子樹這樣 Q 版彎」）：
 * - 樹幹：一開始照參考圖做成一節一節鼓鼓的胖樹幹；同一天使用者「樹往左彎，葉子用現在這版，樹幹用你原本的」→
 *   改回一般椰子樹那種一段段的圓柱（粗一點），只留 Q 版的葉子和椰子
 * - 葉子：七片又寬又厚的葉子從樹頂放射出去，先往上翹再垂下來，上面一條淺色的葉脈
 * - 樹頂下面兩顆大大的青椰子
 * 高約 3.1 × size。bend 是樹頂往哪邊偏（世界的 x, z，長度約 1）
 */
function chibiPalm(b: Batch, x: number, z: number, size: number, bend: THREE.Vector2): void {
  const base = placed(x, z, 0, size)
  const bark = flat(0xa1805a, 1)
  const leaf = [flat(0x4caf50, 0.8), flat(0x3d9a45, 0.8)]
  const vein = flat(0x7fd06a, 0.8)
  const nut = new THREE.MeshStandardMaterial({ color: 0x9fc64a, roughness: 0.55 })
  const height = 2.2
  const at = (t: number) => new THREE.Vector3(bend.x * 0.75 * t ** 1.7, height * t, bend.y * 0.75 * t ** 1.7)
  // 樹幹：跟一般椰子樹一樣一段段接起來的圓柱（粗一點），沿著弧線彎
  const segments = 6
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments
    const t1 = (i + 1) / segments
    b.rod(bark, base, at(t0), at(t1), 0.28 - t0 * 0.11, 0.28 - t1 * 0.11, 8)
  }
  // 樹冠跟著樹幹彎（2026-11-13 使用者「樹葉也要隨著樹幹彎，中心也彎」）：整個樹冠繞樹頂轉到樹幹末端的方向，
  // 葉子和椰子都放在這個歪掉的座標裡，原點在樹頂
  const tangent = new THREE.Vector3(bend.x * 0.75 * 1.7, height, bend.y * 0.75 * 1.7).normalize()
  const crown = new THREE.Matrix4()
    .compose(at(1).addScaledVector(tangent, 0.1), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent), new THREE.Vector3(1, 1, 1))
    .premultiply(base)
  const top = new THREE.Vector3()
  // 葉子：每片沿著一道先翹後垂的弧線放四段，每段是一顆壓得很扁的橢球
  const fronds = 7
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + 0.35
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
    let p = top.clone()
    const pieces = 4
    for (let k = 0; k < pieces; k++) {
      const pitch = 0.5 - k * 0.42
      const dir = out.clone().multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, Math.sin(pitch), 0))
      const len = 0.5
      const width = [0.36, 0.44, 0.36, 0.2][k]
      const up = new THREE.Vector3().crossVectors(side, dir).normalize()
      const mid = p.clone().addScaledVector(dir, len / 2)
      const m = new THREE.Matrix4().makeBasis(dir, up, side).scale(new THREE.Vector3(len * 0.62, 0.05, width)).setPosition(mid)
      b.add(new THREE.SphereGeometry(1, 10, 6), leaf[i % 2], m.clone().premultiply(crown))
      const v = new THREE.Matrix4().makeBasis(dir, up, side).scale(new THREE.Vector3(len * 0.6, 0.02, 0.035)).setPosition(mid.clone().addScaledVector(up, 0.045))
      b.add(new THREE.SphereGeometry(1, 6, 4), vein, v.premultiply(crown))
      p = p.addScaledVector(dir, len * 0.92)
    }
  }
  // 椰子：兩顆大的，掛在樹頂下面、朝鏡頭那一側
  for (const [dx, dz] of [
    [0.4, 0.02],
    [0.04, 0.4],
  ]) b.put(new THREE.SphereGeometry(0.3, 14, 10), nut, crown, top.clone().add(new THREE.Vector3(dx, -0.34, dz)))
}

/** 海螺：一顆螺旋的尖殼躺在沙上，殼口一圈粉紅 */
function conch(b: Batch, x: number, z: number, s: number): void {
  const base = placed(x, z, rand(0, 6.28), s)
  const shellMat = flat(0xf3dcc6, 0.6)
  const pink = flat(0xf0a9a0, 0.6)
  b.put(new THREE.ConeGeometry(0.11, 0.3, 9), shellMat, base, new THREE.Vector3(0.06, 0.1, 0), new THREE.Euler(0, 0, -Math.PI / 2 + 0.25))
  b.put(new THREE.SphereGeometry(0.12, 10, 8), shellMat, base, new THREE.Vector3(-0.08, 0.1, 0), undefined, new THREE.Vector3(1.1, 0.85, 1))
  b.put(new THREE.SphereGeometry(0.075, 8, 6), pink, base, new THREE.Vector3(-0.13, 0.08, 0.07), undefined, new THREE.Vector3(1, 0.8, 0.6))
  for (let i = 0; i < 4; i++) b.put(new THREE.ConeGeometry(0.025, 0.07, 5), shellMat, base, new THREE.Vector3(-0.02 + i * 0.045, 0.2 - i * 0.02, 0))
}

/** 沙灘上與淺水裡比較大的海星、扇貝、海螺（中央島的佈景；都很矮，寵物直接踩過去，不算障礙） */
function seaLife(world: THREE.Object3D, map: RanchMap, opts: NonNullable<RanchMap['seaLife']>, sandSpot: () => [number, number] | null, bedY: (x: number, z: number) => number): void {
  const b = new Batch()
  const id = new THREE.Matrix4()
  const spot = (): [number, number] | null => {
    for (let i = 0; i < 40; i++) {
      const p = sandSpot()
      if (p) return p
    }
    return null
  }
  const stars = [flat(0xf0845c, 0.8), flat(0xf2a23a, 0.8), flat(0xe8607a, 0.8)]
  for (let i = 0; i < opts.stars; i++) {
    const p = spot()
    if (!p) continue
    const s = opts.scale * rand(0.9, 1.25)
    b.put(starfishGeometry(), stars[i % 3], id, new THREE.Vector3(p[0], 0.006, p[1]), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(s, 1.6, s))
  }
  // 淺水裡的海星（2026-11-13 使用者「海星移一些到淺水區」）：躺在離岸 0.05 ～ 0.4 的海底（再深顏色會被海水蓋成灰藍，看不出是海星）
  const bed = map.seabed ?? map.water
  // 隔著半透明的海水看，顏色會被蓋成灰藍、看不出是海星：水裡的另外一組，排在水面之後畫（renderOrder 比水面大、半透明），
  // 顏色就不會被海水蓋掉，只是淡一點，像泡在水裡
  const wet = new Batch()
  const wetStars = [0xf0845c, 0xf2a23a, 0xe8607a].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, transparent: true, opacity: 0.72, depthWrite: false }))
  for (let i = 0, placedCount = 0; i < 600 && placedCount < opts.starsInWater; i++) {
    const x = rand(-8, 8)
    const z = rand(-8, 8)
    const d = bed(x, z)
    if (d < 0.05 || d > 0.4) continue
    const s = opts.scale * rand(0.9, 1.25)
    wet.put(starfishGeometry(), wetStars[placedCount % 3], id, new THREE.Vector3(x, bedY(x, z) + 0.008, z), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(s, 1.6, s))
    placedCount++
  }
  const wetGroup = new THREE.Group()
  wet.build(wetGroup)
  for (const child of wetGroup.children) child.renderOrder = 2
  world.add(wetGroup)
  // 扇貝：半顆壓扁的球，一頭微微翹起來
  const shells = [flat(0xfbe9e0, 0.6), flat(0xf3c9c0, 0.6), flat(0xfdf3d8, 0.6)]
  for (let i = 0; i < opts.shells; i++) {
    const p = spot()
    if (!p) continue
    const r = rand(0.06, 0.09) * opts.scale
    b.put(new THREE.SphereGeometry(r, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), shells[i % 3], id, new THREE.Vector3(p[0], 0, p[1]), new THREE.Euler(0.2, rand(0, 6.28), 0), new THREE.Vector3(1.25, 0.6, 1))
  }
  for (let i = 0; i < opts.conches; i++) {
    const p = spot()
    if (p) conch(b, p[0], p[1], opts.scale * 0.75)
  }
  b.build(world)
}

/** 小船：拖上沙灘的白色小木船，船舷一圈藍邊、兩塊坐板 */
function rowboat(world: THREE.Object3D, x: number, z: number, rot: number): void {
  const b = new Batch()
  const base = placed(x, z, rot)
  const hull = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7, side: THREE.DoubleSide, flatShading: true })
  const inner = new THREE.MeshStandardMaterial({ color: 0xc9a777, roughness: 0.9, side: THREE.DoubleSide, flatShading: true })
  const rim = flat(0x2f7fb8, 0.7)
  const wood = flat(0x9a7448, 0.9)
  const shape = new THREE.Vector3(1.05, 0.36, 0.44)
  // 船殼：壓扁拉長的下半球，裡面再套一層小一點的木頭色
  b.put(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hull, base, new THREE.Vector3(0, 0.36, 0), undefined, shape)
  b.put(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), inner, base, new THREE.Vector3(0, 0.365, 0), undefined, shape.clone().multiplyScalar(0.94))
  b.put(new THREE.TorusGeometry(1, 0.04, 5, 26), rim, base, new THREE.Vector3(0, 0.36, 0), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(1.05, 0.44, 1))
  for (const sx of [-0.38, 0.32]) b.put(new THREE.BoxGeometry(0.12, 0.03, 0.74), wood, base, new THREE.Vector3(sx, 0.27, 0))
  b.build(world)
}

/** 沙堡：一圈矮牆、四個角塔、中間一座高塔，塔頂插一面小紅旗 */
function sandcastle(b: Batch, x: number, z: number): void {
  const base = placed(x, z, 0.4)
  const sand = flat(0xdcc089, 1)
  const sandDark = flat(0xcdb07a, 1)
  b.put(new THREE.CylinderGeometry(0.36, 0.42, 0.14, 8), sandDark, base, new THREE.Vector3(0, 0.07, 0))
  for (const [tx, tz] of [
    [-0.24, -0.24],
    [0.24, -0.24],
    [-0.24, 0.24],
    [0.24, 0.24],
  ]) {
    b.put(new THREE.CylinderGeometry(0.085, 0.1, 0.3, 7), sand, base, new THREE.Vector3(tx, 0.15, tz))
    b.put(new THREE.ConeGeometry(0.1, 0.12, 7), sandDark, base, new THREE.Vector3(tx, 0.36, tz))
  }
  b.put(new THREE.CylinderGeometry(0.13, 0.16, 0.44, 8), sand, base, new THREE.Vector3(0, 0.3, 0))
  b.put(new THREE.ConeGeometry(0.16, 0.16, 8), sandDark, base, new THREE.Vector3(0, 0.6, 0))
  b.put(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4), flat(0x6b4a2e), base, new THREE.Vector3(0, 0.78, 0))
  b.put(new THREE.BoxGeometry(0.11, 0.07, 0.01), flat(0xd9453a), base, new THREE.Vector3(0.055, 0.85, 0))
}

/** 海灘球：六瓣，紅、白、藍、白、黃、白 */
function beachBall(b: Batch, x: number, z: number): void {
  const base = placed(x, z, rand(0, 6.28))
  const colors = [0xe2473f, 0xfbfaf5, 0x2f8fd0, 0xfbfaf5, 0xf6c744, 0xfbfaf5]
  const r = 0.24
  const tilt = new THREE.Euler(0.5, 0, 0.35)
  colors.forEach((c, i) => {
    b.put(new THREE.SphereGeometry(r, 3, 8, (i * Math.PI) / 3, Math.PI / 3), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }), base, new THREE.Vector3(0, r, 0), tilt)
  })
}

/** 衝浪板：插在沙裡、微微往旁邊歪的長橢圓板，中間一條白線 */
function surfboard(b: Batch, x: number, z: number, lean: number, color: number): void {
  // 板面朝鏡頭（右前方）
  const base = placed(x, z, Math.PI / 4)
  const tilt = new THREE.Euler(-0.14, 0, lean)
  b.put(new THREE.SphereGeometry(1, 12, 8), flat(color, 0.5), base, new THREE.Vector3(0, 0.78, 0), tilt, new THREE.Vector3(0.24, 0.92, 0.04))
  b.put(new THREE.BoxGeometry(0.035, 1.5, 0.09), flat(0xfbfaf5, 0.5), base, new THREE.Vector3(0, 0.78, 0), tilt)
}

/** 海星：扁扁的五角星，貼在沙上 */
function starfishGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 0.13 : 0.055
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  return new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false }).rotateX(-Math.PI / 2)
}

/**
 * 蓋整片海灘（ranch-scene.ts 的 build 呼叫）。sandSpot：沙灘上靠海的隨機一點（撒海星、貝殼用），找不到回 null；
 * bedY：這一點的地面或海底高度（棧橋的木樁用）。回傳寵物要繞開的東西
 */
export function buildBeach(world: THREE.Object3D, map: RanchMap, sandSpot: () => [number, number] | null, bedY: (x: number, z: number) => number): BeachObstacle[] {
  const obstacles: BeachObstacle[] = []

  // 椰子樹：靠海的往海那邊彎，其他的隨便彎
  const palms = new Batch()
  const palmMats: PalmMats = {
    trunk: flat(0xa1805a, 1),
    leaf: [flat(0x3f9a50, 0.85), flat(0x52ab5b, 0.85)],
    nut: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }),
  }
  for (const [x, z, size] of map.trees) {
    if (map.palmStyle === 'chibi') {
      // Q 版：往畫面左邊（-x、+z）彎（2026-11-13 使用者「樹往左彎」）
      chibiPalm(palms, x, z, size, new THREE.Vector2(-0.7, 0.7))
      obstacles.push({ x, z, r: 0.3 * size })
      continue
    }
    const lean = x < 1 ? new THREE.Vector2(-1, rand(-0.5, 0.5)).normalize() : new THREE.Vector2(rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(0.6)
    palm(palms, palmMats, x, z, size, lean.multiplyScalar(map.palmLean ?? 1), map.palmGirth)
    obstacles.push({ x, z, r: 0.25 * size * (map.palmGirth ?? 1) })
  }
  palms.build(world)

  // 棧橋不算要繞開的東西：能不能站由 ranch-scene.ts 照 map.pier 判斷（橋面可以走，兩側與橋下不行）
  if (map.pier) pier(world, map.pier, bedY)

  if (map.seaLife) seaLife(world, map, map.seaLife, sandSpot, bedY)
  if (map.volleyball) {
    const [vx, vz] = map.volleyball
    volleyball(world, vx, vz)
    obstacles.push({ x: vx, z: vz, r: 0.36 })
  }
  if (map.raft) {
    const [rx, rz, rrot] = map.raft
    raft(world, rx, rz, rrot, bedY(rx, rz))
    // 長約 1.9：沿長邊放三個圓
    for (const t of [-0.55, 0, 0.55]) obstacles.push({ x: rx + Math.cos(rrot) * t, z: rz - Math.sin(rrot) * t, r: 0.45 })
  }
  for (const [px, pz, prot, psize] of map.parcels ?? []) {
    parcel(world, px, pz, prot, psize)
    obstacles.push({ x: px, z: pz, r: 0.38 * psize })
  }

  const layout = map.beach
  if (!layout) return obstacles

  const [bx, bz, brot] = layout.boat
  rowboat(world, bx, bz, brot)
  // 船身長 2.1：沿著船的方向放三個圓
  for (const t of [-0.6, 0, 0.6]) obstacles.push({ x: bx + Math.cos(brot) * t, z: bz - Math.sin(brot) * t, r: 0.45 })

  const small = new Batch()
  const id = new THREE.Matrix4()
  sandcastle(small, layout.castle[0], layout.castle[1])
  obstacles.push({ x: layout.castle[0], z: layout.castle[1], r: 0.42 })
  beachBall(small, layout.ball[0], layout.ball[1])
  obstacles.push({ x: layout.ball[0], z: layout.ball[1], r: 0.22 })
  const boardColors = [0x2fb3a8, 0xf08a3c, 0xe8537a]
  layout.boards.forEach(([x, z, lean], i) => {
    surfboard(small, x, z, lean, boardColors[i % boardColors.length])
    obstacles.push({ x, z, r: 0.22 })
  })

  // 岸邊的石頭：一大一小
  const rockMats = [flat(0x8e8a80, 1), flat(0x7d7a72, 1)]
  layout.rocks.forEach(([x, z, s], i) => {
    small.put(new THREE.DodecahedronGeometry(s, 0), rockMats[i % 2], id, new THREE.Vector3(x, s * 0.3, z), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
    const a = rand(0, Math.PI * 2)
    small.put(new THREE.DodecahedronGeometry(s * 0.5, 0), rockMats[(i + 1) % 2], id, new THREE.Vector3(x + Math.cos(a) * s * 1.1, s * 0.15, z + Math.sin(a) * s * 1.1), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
    obstacles.push({ x, z, r: s * 0.85 })
  })

  // 開紅花的矮樹叢（草地那一側）
  const shrubMats = [flat(0x3f8f52, 0.95), flat(0x4f9f5c, 0.95)]
  const bloom = new THREE.MeshStandardMaterial({ color: 0xe8455a, roughness: 0.6 })
  layout.shrubs.forEach(([x, z, s], i) => {
    small.put(new THREE.IcosahedronGeometry(s, 1), shrubMats[i % 2], id, new THREE.Vector3(x, s * 0.45, z), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1, 0.72, 1))
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + rand(0, 0.5)
      const h = rand(0.35, 0.95)
      const r = s * Math.sqrt(Math.max(0.05, 1 - h * h * 0.8))
      small.put(new THREE.SphereGeometry(0.055, 7, 5), bloom, id, new THREE.Vector3(x + Math.cos(a) * r, s * 0.45 + h * s * 0.7, z + Math.sin(a) * r))
    }
    obstacles.push({ x, z, r: s * 0.85 })
  })

  // 漂流木：一根躺在沙上的灰白木頭，旁邊一根短的
  const [dx, dz, drot] = layout.driftwood
  const drift = flat(0xa89878, 1)
  const along = new THREE.Vector3(Math.cos(drot), 0, -Math.sin(drot))
  small.rod(drift, id, new THREE.Vector3(dx, 0.07, dz).addScaledVector(along, -0.6), new THREE.Vector3(dx, 0.09, dz).addScaledVector(along, 0.6), 0.075, 0.055, 6)
  small.rod(drift, id, new THREE.Vector3(dx, 0.08, dz).addScaledVector(along, 0.15), new THREE.Vector3(dx + 0.25, 0.26, dz + 0.3).addScaledVector(along, 0.3), 0.04, 0.02, 5)
  obstacles.push({ x: dx, z: dz, r: 0.5 })

  // 海星與貝殼：很小，寵物直接踩過去
  const star = flat(0xf0845c, 0.8)
  const shell = [flat(0xfbe9e0, 0.6), flat(0xf3c9c0, 0.6)]
  for (let i = 0; i < 6; i++) {
    const p = sandSpot()
    if (!p) continue
    small.put(starfishGeometry(), star, id, new THREE.Vector3(p[0], 0.004, p[1]), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1, 1, 1).multiplyScalar(rand(0.8, 1.2)))
  }
  for (let i = 0; i < 12; i++) {
    const p = sandSpot()
    if (!p) continue
    const r = rand(0.04, 0.07)
    small.put(new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), shell[i % 2], id, new THREE.Vector3(p[0], 0, p[1]), new THREE.Euler(0, rand(0, 6.28), 0), new THREE.Vector3(1.3, 0.8, 1))
  }
  small.build(world)
  return obstacles
}
