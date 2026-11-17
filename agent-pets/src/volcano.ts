/**
 * 火山口湖地圖的東西（2026-11-12 使用者「中央湖改為火山口湖」；ranch-maps.ts 的 lake-center）。
 *
 * 樣子先在預覽頁（showcase/crater.html）調過，使用者選定「活火山、但是不要有岩漿」：
 * - 整片地面是深色的火山岩與火山灰，沒有草、沒有花
 * - 一座隆起的火山，湖在山頂：湖水是偏白的青綠色（酸性火山湖），岸邊是硫磺的黃
 * - 火口緣一圈石頭、缺口兩側各一塊大石頭、山坡上滾落的石頭
 * - 山坡上幾個噴氣孔，冒著慢慢往上飄的煙（Steam，RanchScene.render 每格更新）
 * - 山下的平地幾棵燒焦的枯樹、零星的火山岩
 * - 🔴 沒有岩漿：預覽頁原本有發亮的熔岩裂縫，使用者說不要，不要再加回來
 *
 * 都用程式產生，不用圖檔。火山的形狀（高度、湖的大小、缺口）在 ranch-maps.ts 的 CRATER。
 */
import * as THREE from 'three'

import { Batch, flat, rand } from './batch'
import { edgeDist, type CraterShape, type RanchMap } from './ranch-maps'

/** 火山的配色（ranch-scene.ts 的 buildIsland、柵欄用） */
export const VOLCANO_GROUND = {
  /** 平地的兩種深淺 */
  ash: 0x4d4844,
  ash2: 0x59534d,
  /** 山坡下半、上半與火口內壁的岩石 */
  slope: 0x443f3c,
  crest: 0x35302e,
  /** 湖岸（硫磺）、淺水與深水的湖底 */
  shore: 0xcdb95e,
  bedShallow: 0xa9e3d3,
  bedDeep: 0x2a8f8c,
  /** 小島側面 */
  cliff: 0x4a3f3a,
}
export const VOLCANO_WATER = 0x5fd0c2
export const VOLCANO_WATER_OPACITY = 0.68
export const VOLCANO_WOOD = { fence: 0x5a4a40, gate: 0x463a33 }

const smooth = THREE.MathUtils.smoothstep

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface VolcanoObstacle {
  x: number
  z: number
  r: number
}

const palette = {
  ash: new THREE.Color(VOLCANO_GROUND.ash),
  ash2: new THREE.Color(VOLCANO_GROUND.ash2),
  slope: new THREE.Color(VOLCANO_GROUND.slope),
  crest: new THREE.Color(VOLCANO_GROUND.crest),
  shore: new THREE.Color(VOLCANO_GROUND.shore),
  shallow: new THREE.Color(VOLCANO_GROUND.bedShallow),
  deep: new THREE.Color(VOLCANO_GROUND.bedDeep),
}

/**
 * 地面一個頂點的顏色（ranch-scene.ts 的 buildIsland 每個頂點呼叫一次，結果寫進 c）。
 * d：水域距離（> 0 在湖裡）；y：這一點的地面高度
 */
export function volcanoGroundColor(crater: CraterShape, x: number, z: number, d: number, y: number, c: THREE.Color): void {
  if (d > 0) {
    c.copy(palette.shore).lerp(palette.shallow, smooth(d, 0, 0.5))
    c.lerp(palette.deep, smooth(d, 0.6, 2.0))
    return
  }
  if (d > -0.55) {
    c.copy(palette.shore)
    return
  }
  // 平地的火山灰 → 山坡下半 → 上半與火口內壁的岩石
  const a = Math.atan2(z - crater.z, x - crater.x)
  const f = y / crater.rimTop(a)
  c.copy(palette.ash).lerp(palette.ash2, 0.5 + 0.5 * Math.sin(x * 1.3) * Math.sin(z * 1.7))
  c.lerp(palette.slope, smooth(y, 0.03, 0.35))
  const inner = -d < crater.crest ? 1 : 0
  c.lerp(palette.crest, Math.max(smooth(f, 0.5, 0.82), inner * smooth(y - crater.lift, 0.05, 0.25)))
  // 岸邊往外一小段還帶著硫磺的顏色，漸漸接到內壁
  c.lerp(palette.shore, 1 - smooth(-d, 0.55, 0.78))
}

/** 噴氣孔的煙：每一團從孔口往上飄、變大、變淡，飄到頂再從頭來 */
export class Steam {
  readonly group = new THREE.Group()
  private readonly puffs: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number }[] = []
  private time = Math.random() * 10

  /** 在 at 這個孔口加幾團煙 */
  addVent(at: THREE.Vector3, count: number): void {
    for (let k = 0; k < count; k++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: 0xbfb8b2, roughness: 1, flatShading: true, transparent: true, opacity: 0.8, depthWrite: false }),
      )
      mesh.renderOrder = 4
      this.group.add(mesh)
      this.puffs.push({ mesh, base: at.clone(), phase: k / count + rand(0, 0.1) })
    }
    this.update(0)
  }

  update(dt: number): void {
    this.time += dt
    for (const p of this.puffs) {
      const t = (this.time * 0.12 + p.phase) % 1
      p.mesh.position.set(p.base.x + t * 0.45, p.base.y + t * 2.3, p.base.z - t * 0.25)
      p.mesh.scale.setScalar(0.13 + t * 0.46)
      ;(p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.78 * (1 - t) ** 1.4
    }
  }
}

/** 燒焦的枯樹：一根歪歪的黑樹幹、幾根光禿禿的枝 */
function deadTree(b: Batch, x: number, y: number, z: number, size: number): void {
  const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6.28)), new THREE.Vector3(size, size, size))
  const char = flat(0x2a2422, 1)
  const top = new THREE.Vector3(rand(-0.1, 0.1), 1.5, rand(-0.1, 0.1))
  b.rod(char, base, new THREE.Vector3(0, 0, 0), top, 0.09, 0.03, 6)
  for (let i = 0; i < 4; i++) {
    const h = 0.6 + i * 0.22
    const a = i * 2.3 + rand(0, 0.5)
    const from = top.clone().multiplyScalar(h / 1.5)
    b.rod(char, base, from, from.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4)), 0.03, 0.01, 4)
  }
}

/**
 * 蓋火山上的東西（ranch-scene.ts 的 build 呼叫）：火口緣與山坡的石頭、噴氣孔與煙、平地的枯樹與火山岩。
 * groundY：這一點的地面高度（lake.ts 的 bedY）。回傳寵物要繞開的東西，以及要每格更新的煙
 */
export function buildVolcano(world: THREE.Object3D, map: RanchMap, groundY: (x: number, z: number) => number): { obstacles: VolcanoObstacle[]; steam: Steam } {
  const obstacles: VolcanoObstacle[] = []
  const steam = new Steam()
  world.add(steam.group)
  const crater = map.crater
  if (!crater) return { obstacles, steam }

  /** 火山上、這個方向（弧度）、離湖岸 s 的一點 */
  const at = (a: number, s: number): THREE.Vector3 => {
    const r = crater.radiusAt(a) + s
    const x = crater.x + Math.cos(a) * r
    const z = crater.z + Math.sin(a) * r
    return new THREE.Vector3(x, groundY(x, z), z)
  }
  const b = new Batch()
  const id = new THREE.Matrix4()
  const rocks = [flat(0x3a3634, 1), flat(0x4a4542, 1)]
  const rock = (p: THREE.Vector3, r: number, i: number, squash = 0.75): void => {
    b.put(new THREE.DodecahedronGeometry(r, 0), rocks[i % 2], id, p.clone().add(new THREE.Vector3(0, r * 0.25, 0)), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, squash, 1))
  }

  // 火口緣上的石頭：沿著稜線一圈，缺口的地方不放
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rand(-0.04, 0.04)
    if (crater.notch(a) < 0.75) continue
    rock(at(a, crater.crest + rand(-0.15, 0.25)), rand(0.14, 0.32), i, rand(0.6, 0.9))
  }
  // 缺口兩側各一塊大石頭，像門柱
  for (const c of crater.notches) for (const side of [-0.5, 0.5]) rock(at(c + side, 0.8), 0.4, 0, 0.8)
  // 山坡上滾落的石頭（只放在山坡上，那裡寵物本來就不去）
  for (let i = 0; i < 16; i++) {
    const p = at(rand(0, Math.PI * 2), rand(crater.crest + 0.6, crater.slopeEnd - 0.4))
    if (edgeDist(p.x, p.z) < 0.9) continue
    rock(p, rand(0.16, 0.36), i, 0.7)
  }

  // 噴氣孔：山坡上一片硫磺黃、一小圈深色的石頭，上面冒煙（挑朝前、看得到的那幾個方向）
  const sulfur = flat(0xd8c64a, 1)
  for (const a of [0.2, 1.5, 2.2, 5.4, 6.0]) {
    const p = at(a, crater.crest + 0.7)
    b.put(new THREE.CylinderGeometry(0.3, 0.36, 0.03, 9), sulfur, id, p.clone().add(new THREE.Vector3(0, 0.04, 0)))
    b.put(new THREE.ConeGeometry(0.18, 0.16, 7), rocks[0], id, p.clone().add(new THREE.Vector3(0, 0.1, 0)))
    steam.addVent(p.clone().add(new THREE.Vector3(0, 0.2, 0)), 5)
  }

  // 山下的平地：幾棵枯樹、幾顆火山岩。落在不能去的地方（山坡、山後面）的就不擺
  const flatSpot = (x: number, z: number): boolean => !map.noGo?.(x, z) && edgeDist(x, z) > 0.7
  for (const [x, z, size] of [
    [7.0, -5.0, 1.0],
    [-5.2, 7.0, 0.9],
    [6.7, 6.3, 0.85],
  ]) {
    if (!flatSpot(x, z)) continue
    deadTree(b, x, groundY(x, z), z, size)
    obstacles.push({ x, z, r: 0.22 })
  }
  ;[
    [6.5, 4.0, 0.36],
    [7.0, -2.4, 0.3],
    [2.2, 7.0, 0.28],
    [-6.6, 6.4, 0.34],
  ].forEach(([x, z, s], i) => {
    if (!flatSpot(x, z)) return
    rock(new THREE.Vector3(x, 0, z), s, i, 0.7)
    rock(new THREE.Vector3(x + s * 1.1, 0, z + s * 0.4), s * 0.5, i + 1, 0.7)
    obstacles.push({ x, z, r: s * 0.85 })
  })
  b.build(world)
  return { obstacles, steam }
}
