/**
 * 海底世界地圖的東西（2026-11-17 使用者「海底世界……跟月面相反，中間一個罩子，裡面是陸地」；ranch-maps.ts 的 undersea）。
 *
 * - 整座島沉在海裡：一片半透明、會閃著光紋的海面蓋在上面，小島四周一圈淡藍的水牆，看起來像一缸水族箱
 * - 中間一個玻璃罩，裡面是陸地（草地、樹、花草照一般地圖蓋，ranch-scene.ts）；罩子底下一圈金屬底座、幾道肋條
 * - 罩外的海床：細沙與淡淡的沙紋、珊瑚（分枝、腦紋、管狀）、會晃的海草、礁石、沉在海底的寶箱、往上冒的氣泡、
 *   繞著罩子游的小魚群、從海面斜照下來的幾道光
 * - 水系寶可夢浮在海床上不同的高度（pet-actor.ts 的 updateUndersea），這裡不管
 *
 * 都用程式產生，不用圖檔。罩子、海面的高度在 ranch-maps.ts 的 undersea。
 */
import * as THREE from 'three'

import { Batch, flat, placed, rand } from './batch'
import { CZ, edgeDist, outline, type RanchMap } from './ranch-maps'

/** 海底世界的配色（ranch-scene.ts 的 buildIsland 用） */
export const UNDERSEA_GROUND = {
  /** 罩子裡的草地 */
  grass: 0x6fae5c,
  grass2: 0x7dba66,
  /** 罩子底座旁、海床的沙 */
  sand: 0xd9cfa6,
  sand2: 0xc9c194,
  /** 海床遠一點的地方偏藍（隔著海水看） */
  deepSand: 0x9fb8b4,
  /** 小島側面 */
  cliff: 0x8a7e66,
}

const smooth = THREE.MathUtils.smoothstep
const palette = {
  grass: new THREE.Color(UNDERSEA_GROUND.grass),
  grass2: new THREE.Color(UNDERSEA_GROUND.grass2),
  sand: new THREE.Color(UNDERSEA_GROUND.sand),
  sand2: new THREE.Color(UNDERSEA_GROUND.sand2),
  deep: new THREE.Color(UNDERSEA_GROUND.deepSand),
}

/** 地面一個頂點的顏色（結果寫進 c）。d：海的距離（> 0 在罩子外的海裡） */
export function underseaGroundColor(x: number, z: number, d: number, c: THREE.Color): void {
  if (d < -0.55) {
    // 罩子裡：草地，靠玻璃那一圈慢慢變成沙
    c.copy(palette.grass).lerp(palette.grass2, 0.5 + 0.5 * Math.sin(x * 1.3) * Math.sin(z * 1.7))
    c.lerp(palette.sand, 1 - smooth(-d, 0.55, 1.0))
    return
  }
  // 海床：沙，一道道淡淡的沙紋，越往外越偏藍
  const ripple = 0.5 + 0.5 * Math.sin(x * 3.1 + z * 2.2 + Math.sin(z * 0.8) * 1.5)
  c.copy(palette.sand).lerp(palette.sand2, ripple * 0.7)
  c.lerp(palette.deep, 0.55 * smooth(d, 0.2, 2.2))
}

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface UnderseaObstacle {
  x: number
  z: number
  r: number
}

/** 會動的東西（放進 RanchScene.animated，每格呼叫 update） */
interface Animated {
  update(dt: number): void
}

/** 罩外海床上的一點：從罩子圓心往外，角度 a、離玻璃 out 遠（還要在小島裡面） */
function seaSpot(map: RanchMap, a: number, out: number): [number, number] | null {
  const dome = map.undersea!.dome
  const r = dome.r + out
  const x = dome.x + Math.cos(a) * r
  const z = dome.z + Math.sin(a) * r
  return edgeDist(x, z) > 0.7 ? [x, z] : null
}

/** 蓋海底世界的擺設（ranch-scene.ts 的 build 呼叫）。groundY：這一點的地面或海床高度 */
export function buildUndersea(world: THREE.Object3D, map: RanchMap, groundY: (x: number, z: number) => number, animated: Animated[]): UnderseaObstacle[] {
  const obstacles: UnderseaObstacle[] = []
  const sea = map.undersea
  if (!sea) return obstacles
  const { dome, surface } = sea
  const b = new Batch()
  const id = new THREE.Matrix4()

  // ── 玻璃罩 ──
  const metal = new THREE.MeshStandardMaterial({ color: 0xd7dde6, roughness: 0.35, metalness: 0.6 })
  const squash = dome.height / dome.r
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(dome.r, 56, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false }),
  )
  shell.position.set(dome.x, 0, dome.z)
  shell.scale.y = squash
  shell.renderOrder = 6
  world.add(shell)
  b.put(new THREE.TorusGeometry(dome.r, 0.11, 8, 96), metal, id, new THREE.Vector3(dome.x, 0.05, dome.z), new THREE.Euler(Math.PI / 2, 0, 0))
  for (let k = 0; k < 4; k++) {
    b.put(new THREE.TorusGeometry(dome.r, 0.03, 5, 56, Math.PI), metal, id, new THREE.Vector3(dome.x, 0, dome.z), new THREE.Euler(0, (k * Math.PI) / 4, 0), new THREE.Vector3(1, squash, 1))
  }
  b.put(new THREE.TorusGeometry(dome.r * Math.cos(Math.PI / 4), 0.026, 5, 72), metal, id, new THREE.Vector3(dome.x, dome.height * Math.sin(Math.PI / 4), dome.z), new THREE.Euler(Math.PI / 2, 0, 0))
  b.put(new THREE.CylinderGeometry(0.28, 0.36, 0.12, 14), metal, id, new THREE.Vector3(dome.x, dome.height + 0.02, dome.z))

  // ── 珊瑚：分枝的（橘、粉）、腦紋的（圓圓一團）、管狀的（紫）、海葵（一撮小觸手） ──
  const coralColors = [0xff7a5c, 0xff9ec7, 0xffb347, 0xe86aa0]
  const brainColors = [0xe9c46a, 0xf4a3a8, 0x9fd8a0]
  const tubeMat = flat(0x8e6cc9, 0.7)
  const anemoneMat = flat(0xff6f91, 0.6)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f7a7c, roughness: 1, flatShading: true })
  const n = 26
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.08, 0.08)
    const spot = seaSpot(map, a, rand(1.2, 3.2))
    if (!spot) continue
    const [x, z] = spot
    const y = groundY(x, z)
    const kind = i % 5
    const base = placed(x, z, rand(0, 6)).multiply(new THREE.Matrix4().makeTranslation(0, y, 0))
    if (kind === 0 || kind === 3) {
      // 分枝珊瑚：主幹往上分三四枝，枝頭再分叉
      const mat = flat(coralColors[i % coralColors.length], 0.7)
      const top = new THREE.Vector3(0, rand(0.35, 0.55), 0)
      b.rod(mat, base, new THREE.Vector3(0, 0, 0), top, 0.06, 0.045, 6)
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + rand(-0.3, 0.3)
        const end = top.clone().add(new THREE.Vector3(Math.cos(ang) * 0.22, rand(0.15, 0.3), Math.sin(ang) * 0.22))
        b.rod(mat, base, top.clone().multiplyScalar(0.7), end, 0.04, 0.03, 5)
        b.rod(mat, base, end, end.clone().add(new THREE.Vector3(Math.cos(ang + 0.7) * 0.1, 0.14, Math.sin(ang + 0.7) * 0.1)), 0.03, 0.02, 5)
      }
    } else if (kind === 1) {
      // 腦紋珊瑚：壓扁的一團
      b.put(new THREE.IcosahedronGeometry(rand(0.22, 0.32), 1), flat(brainColors[i % brainColors.length], 0.9), base, new THREE.Vector3(0, 0.08, 0), undefined, new THREE.Vector3(1, 0.7, 1))
    } else if (kind === 2) {
      // 管狀海綿：三四根高低不一的紫管
      for (let k = 0; k < 4; k++) {
        const h = rand(0.25, 0.55)
        b.put(new THREE.CylinderGeometry(0.06, 0.07, h, 8, 1, true), tubeMat, base, new THREE.Vector3(Math.cos(k * 1.7) * 0.11, h / 2, Math.sin(k * 1.7) * 0.11))
      }
    } else {
      // 礁石＋海葵
      b.put(new THREE.DodecahedronGeometry(rand(0.2, 0.32), 0), rockMat, base, new THREE.Vector3(0, 0.05, 0), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.6, 1))
      for (let k = 0; k < 9; k++) {
        const ang = (k / 9) * Math.PI * 2
        b.rod(anemoneMat, base, new THREE.Vector3(Math.cos(ang) * 0.05, 0.2, Math.sin(ang) * 0.05), new THREE.Vector3(Math.cos(ang) * 0.13, 0.36, Math.sin(ang) * 0.13), 0.022, 0.012, 4)
      }
    }
  }

  // ── 寶箱：沉在海床上、稍微歪一邊，箱蓋打開一條縫，金色的邊 ──
  const chestSpot = seaSpot(map, Math.PI * 0.25, 1.6)
  if (chestSpot) {
    const [cx, cz] = chestSpot
    const base = placed(cx, cz, -0.6).multiply(new THREE.Matrix4().makeTranslation(0, groundY(cx, cz) - 0.04, 0)).multiply(new THREE.Matrix4().makeRotationZ(0.08))
    const wood = flat(0x8a5a2e, 0.9)
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b84a, roughness: 0.35, metalness: 0.7 })
    b.put(new THREE.BoxGeometry(0.7, 0.36, 0.46), wood, base, new THREE.Vector3(0, 0.18, 0))
    b.put(new THREE.CylinderGeometry(0.23, 0.23, 0.7, 12, 1, false, 0, Math.PI), wood, base, new THREE.Vector3(0, 0.38, -0.03), new THREE.Euler(-0.25, 0, Math.PI / 2))
    for (const sx of [-0.3, 0.3]) b.put(new THREE.BoxGeometry(0.05, 0.38, 0.48), gold, base, new THREE.Vector3(sx, 0.19, 0))
    b.put(new THREE.BoxGeometry(0.1, 0.12, 0.04), gold, base, new THREE.Vector3(0, 0.3, 0.24))
    // 箱蓋縫裡透出來的金光
    b.put(new THREE.BoxGeometry(0.6, 0.03, 0.4), new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb020, emissiveIntensity: 0.8 }), base, new THREE.Vector3(0, 0.37, 0))
  }

  // ── 會晃的海草：一節節往上疊，每節照時間左右擺，越上面擺越大 ──
  const kelpMat = flat(0x3f9a5a, 0.8)
  const kelpMat2 = flat(0x58b06a, 0.8)
  const kelps: { segs: THREE.Object3D[]; phase: number }[] = []
  for (let i = 0; i < 14; i++) {
    const spot = seaSpot(map, (i / 14) * Math.PI * 2 + 0.2, rand(0.7, 3.0))
    if (!spot) continue
    const [x, z] = spot
    let parent: THREE.Object3D = new THREE.Group()
    parent.position.set(x, groundY(x, z), z)
    parent.rotation.y = rand(0, 6)
    world.add(parent)
    const segs: THREE.Object3D[] = []
    const count = 6 + Math.floor(Math.random() * 4)
    for (let k = 0; k < count; k++) {
      const seg = new THREE.Group()
      seg.position.y = k === 0 ? 0 : 0.26
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 0.025), k % 2 ? kelpMat : kelpMat2)
      leaf.position.y = 0.13
      seg.add(leaf)
      parent.add(seg)
      segs.push(seg)
      parent = seg
    }
    kelps.push({ segs, phase: rand(0, 6) })
  }

  // ── 海面與水牆：半透明的藍，海面上一層會慢慢流動的光紋 ──
  const ring = outline(0, 240)
  const caustics = causticTexture()
  caustics.wrapS = caustics.wrapT = THREE.RepeatWrapping
  caustics.repeat.set(3, 3)
  const top = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.y)))).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7fd4f2, map: caustics, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  top.position.y = surface
  top.renderOrder = 8
  world.add(top)
  const wallPos: number[] = []
  const wallIdx: number[] = []
  ring.forEach((p) => wallPos.push(p.x, Math.min(groundY(p.x, p.y), 0), p.y, p.x, surface, p.y))
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    wallIdx.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1)
  }
  const wallGeo = new THREE.BufferGeometry()
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3))
  wallGeo.setIndex(wallIdx)
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: 0x4fb4e0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }))
  wall.renderOrder = 7
  world.add(wall)

  // ── 從海面斜照下來的光：幾道很淡的光柱，慢慢一明一暗 ──
  const rays: THREE.Mesh[] = []
  for (let i = 0; i < 5; i++) {
    const a = rand(0, Math.PI * 2)
    const r = rand(1.5, 6)
    const x = Math.cos(a) * r
    const z = CZ + Math.sin(a) * r
    const h = surface + 0.2
    const ray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.18, h, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    )
    ray.position.set(x, h / 2, z)
    ray.rotation.set(0.25, 0, -0.2)
    ray.renderOrder = 5
    ray.userData.phase = rand(0, 6)
    world.add(ray)
    rays.push(ray)
  }

  // ── 小魚群：兩群，各七八條，繞著罩子游 ──
  const fishMats = [flat(0xffd166, 0.6), flat(0x5ec8ff, 0.6)]
  const schools: { group: THREE.Group; radius: number; speed: number; y: number; angle: number }[] = []
  for (let s = 0; s < 2; s++) {
    const group = new THREE.Group()
    for (let k = 0; k < 8; k++) {
      const fish = new THREE.Group()
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), fishMats[s])
      body.rotation.z = -Math.PI / 2
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), fishMats[s])
      tail.rotation.z = Math.PI / 2
      tail.position.x = -0.15
      fish.add(body, tail)
      fish.position.set(rand(-0.4, 0.4), rand(-0.25, 0.25), rand(-0.4, 0.4))
      group.add(fish)
    }
    world.add(group)
    // 兩群魚繞的圈都要在小島裡面、海面底下
    schools.push({ group, radius: dome.r + 0.9 + s * 0.8, speed: s ? -0.18 : 0.24, y: s ? 2.0 : 1.6, angle: rand(0, 6) })
  }

  b.build(world)

  // ── 往上冒的氣泡 ──
  const bubbles = new Bubbles(map, surface)
  world.add(bubbles.points)
  animated.push(bubbles)

  let t = 0
  animated.push({
    update(dt: number) {
      t += dt
      caustics.offset.set(t * 0.02, t * 0.013)
      for (const k of kelps) {
        k.segs.forEach((seg, i) => {
          seg.rotation.z = Math.sin(t * 0.9 + k.phase + i * 0.45) * 0.09 * (1 + i * 0.15)
          seg.rotation.x = Math.sin(t * 0.6 + k.phase * 1.3 + i * 0.3) * 0.05
        })
      }
      for (const ray of rays) (ray.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.04 * Math.sin(t * 0.5 + (ray.userData.phase as number))
      for (const s of schools) {
        s.angle += s.speed * dt
        const x = dome.x + Math.cos(s.angle) * s.radius
        const z = dome.z + Math.sin(s.angle) * s.radius
        s.group.position.set(x, s.y + Math.sin(t * 0.7 + s.radius) * 0.15, z)
        // 魚頭朝前進的方向（繞圈的切線）
        s.group.rotation.y = -s.angle + (s.speed > 0 ? -Math.PI / 2 : Math.PI / 2)
      }
    },
  })
  return obstacles
}

/** 海面的光紋：幾條彎彎的亮線交錯，重複貼在海面上慢慢流動 */
function causticTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(0, 0, size, size)
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = 3
  for (let k = 0; k < 9; k++) {
    g.beginPath()
    const y0 = (k / 9) * size
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin((x / size) * Math.PI * 4 + k * 1.3) * 10 + Math.sin((x / size) * Math.PI * 2 + k) * 6
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  return new THREE.CanvasTexture(canvas)
}

/** 氣泡的貼圖：一個小圓圈，邊亮中間透 */
function bubbleTexture(): THREE.Texture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.15)')
  grad.addColorStop(0.75, 'rgba(255,255,255,0.85)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

/** 從罩外的海床冒出來、一路往上飄到海面、再從海床重新冒出來的氣泡 */
class Bubbles {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly speed: Float32Array
  private readonly phase: Float32Array
  private readonly map: RanchMap
  private readonly top: number
  private time = 0

  constructor(map: RanchMap, top: number, count = 70) {
    this.map = map
    this.top = top
    this.pos = new Float32Array(count * 3)
    this.speed = new Float32Array(count)
    this.phase = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.respawn(i, rand(0, top))
      this.speed[i] = rand(0.3, 0.7)
      this.phase[i] = Math.random() * Math.PI * 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const mat = new THREE.PointsMaterial({ color: 0xdff6ff, size: 7, sizeAttenuation: false, map: bubbleTexture(), transparent: true, opacity: 0.9, depthWrite: false })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  private respawn(i: number, y: number): void {
    const spot = seaSpot(this.map, rand(0, Math.PI * 2), rand(0.4, 3.2)) ?? [0, CZ + 6]
    this.pos[i * 3] = spot[0]
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = spot[1]
  }

  update(dt: number): void {
    this.time += dt
    for (let i = 0; i < this.speed.length; i++) {
      this.pos[i * 3 + 1] += this.speed[i] * dt
      const wiggle = Math.sin(this.time * 3 + this.phase[i]) * 0.2 * dt
      this.pos[i * 3] += wiggle
      this.pos[i * 3 + 2] -= wiggle
      if (this.pos[i * 3 + 1] > this.top - 0.05) this.respawn(i, -0.5)
    }
    this.points.geometry.attributes.position.needsUpdate = true
  }
}
