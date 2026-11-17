/**
 * 中央河（河畔露營）地圖的東西（2026-11-12 使用者「中央河你也重構一版」；ranch-maps.ts 的 river）。
 * 都在上岸那塊沙地上（使用者之前指定上岸是沙地）。上岸不大，營地縮在最後面的頂角，前面的沙地留給寵物：
 * - 帳篷：橘色的 A 字帳，門朝鏡頭
 * - 營火：一圈石頭、幾根交叉的柴、會晃動的火焰（Campfire，RanchScene.render 每格更新）、地上一圈暖光、往上飄的煙
 * - 兩段當椅子的木頭、拖在河邊的紅色獨木舟與一支槳
 * - 後緣幾棵小松樹、幾顆石頭
 *
 * 下岸的草地照一般的草地地圖（樹、草叢、花）。都用程式產生，不用圖檔。每樣東西的位置在 ranch-maps.ts 的 CampLayout。
 */
import * as THREE from 'three'

import { Batch, flat, placed, rand } from './batch'
import type { RanchMap } from './ranch-maps'

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface CampObstacle {
  x: number
  z: number
  r: number
}

/** 帳篷：三角柱的 A 字帳，前面一片深色的門，底下一塊地布 */
function tent(world: THREE.Object3D, x: number, z: number): void {
  const b = new Batch()
  // 轉 45°：local 的 +z（門那一面）朝鏡頭
  const base = placed(x, z, Math.PI / 4)
  const canvas = new THREE.MeshStandardMaterial({ color: 0xe58a3a, roughness: 0.9, flatShading: true, side: THREE.DoubleSide })
  const inside = flat(0x3a2c26, 1)
  const half = 0.85
  const height = 1.2
  const depth = 1.9
  const tri = new THREE.Shape()
  tri.moveTo(-half, 0)
  tri.lineTo(half, 0)
  tri.lineTo(0, height)
  tri.closePath()
  b.put(new THREE.ExtrudeGeometry(tri, { depth, bevelEnabled: false }), canvas, base, new THREE.Vector3(0, 0, -depth / 2))
  // 門：前面那片三角形中間一塊深色（看進去是暗的）
  const door = new THREE.Shape()
  door.moveTo(-0.34, 0)
  door.lineTo(0.34, 0)
  door.lineTo(0, 0.86)
  door.closePath()
  b.put(new THREE.ShapeGeometry(door), inside, base, new THREE.Vector3(0, 0.01, depth / 2 + 0.006))
  // 地布：比帳篷大一點的深綠色薄片
  b.put(new THREE.BoxGeometry(half * 2 + 0.3, 0.02, depth + 0.5), flat(0x4f7a5a, 1), base, new THREE.Vector3(0, 0.012, 0.1))
  // 屋脊前後各一根營柱
  const pole = flat(0x6b4a2e, 1)
  for (const sz of [-1, 1]) b.put(new THREE.CylinderGeometry(0.02, 0.02, height + 0.12, 5), pole, base, new THREE.Vector3(0, (height + 0.12) / 2, sz * (depth / 2 + 0.01)))
  b.build(world)
}

/** 暖光照在地上的那一圈：中間亮、往外淡出的圓 */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,170,70,0.6)')
  grad.addColorStop(0.45, 'rgba(255,160,60,0.26)')
  grad.addColorStop(1, 'rgba(255,150,50,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 營火：會晃動的火焰、忽明忽暗的地面暖光、往上飄散的煙 */
export class Campfire {
  readonly group = new THREE.Group()
  private readonly flames: THREE.Mesh[] = []
  private readonly glow: THREE.Mesh
  private readonly smoke: { mesh: THREE.Mesh; phase: number }[] = []
  private time = Math.random() * 10

  constructor(x: number, z: number) {
    this.group.position.set(x, 0, z)
    // 顏色要夠飽和：場景的色調映射會把發光的顏色洗淡
    const colors = [0xff5a00, 0xff8c0a, 0xffc61a]
    const sizes: [number, number][] = [
      [0.2, 0.52],
      [0.14, 0.4],
      [0.08, 0.26],
    ]
    sizes.forEach(([r, h], i) => {
      const geo = new THREE.ConeGeometry(r, h, 6)
      // 圓錐的底移到原點，縮放時才是從地上往上長
      geo.translate(0, h / 2, 0)
      const flame = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[i], emissive: colors[i], emissiveIntensity: 0.75, roughness: 0.7, flatShading: true }))
      flame.position.set(i === 1 ? 0.06 : i === 2 ? -0.04 : 0, 0.1, i === 1 ? -0.03 : 0.04)
      this.flames.push(flame)
      this.group.add(flame)
    })
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false }))
    this.glow.position.y = 0.014
    this.glow.renderOrder = 1
    this.group.add(this.glow)
    for (let k = 0; k < 4; k++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: 0xd9d6d0, roughness: 1, flatShading: true, transparent: true, opacity: 0.6, depthWrite: false }),
      )
      mesh.renderOrder = 4
      this.smoke.push({ mesh, phase: k / 4 })
      this.group.add(mesh)
    }
    this.update(0)
  }

  update(dt: number): void {
    this.time += dt
    const t = this.time
    this.flames.forEach((flame, i) => {
      const flicker = 1 + 0.16 * Math.sin(t * (9 + i * 3.1) + i) + 0.08 * Math.sin(t * (17 + i * 5))
      flame.scale.set(1 + 0.08 * Math.sin(t * 7 + i * 2), flicker, 1 + 0.08 * Math.cos(t * 6 + i))
    })
    ;(this.glow.material as THREE.MeshBasicMaterial).opacity = 0.85 + 0.15 * Math.sin(t * 8) * Math.sin(t * 3.3)
    for (const s of this.smoke) {
      const k = (t * 0.14 + s.phase) % 1
      s.mesh.position.set(k * 0.4, 0.6 + k * 2.0, -k * 0.2)
      s.mesh.scale.setScalar(0.06 + k * 0.24)
      ;(s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - k) ** 1.5
    }
  }
}

/** 營火底下不會動的部分：一圈石頭、幾根交叉的柴 */
function firePit(b: Batch, x: number, z: number): void {
  const id = new THREE.Matrix4()
  const stone = [flat(0x8b8780, 1), flat(0x77736c, 1)]
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const r = rand(0.07, 0.1)
    b.put(new THREE.DodecahedronGeometry(r, 0), stone[i % 2], id, new THREE.Vector3(x + Math.cos(a) * 0.34, r * 0.5, z + Math.sin(a) * 0.34), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.8, 1))
  }
  const wood = flat(0x5a3b28, 1)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + 0.3
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    b.rod(wood, id, new THREE.Vector3(x, 0.05, z).addScaledVector(dir, -0.26), new THREE.Vector3(x, 0.16, z).addScaledVector(dir, 0.22), 0.045, 0.035, 6)
  }
}

/** 獨木舟：細長的紅色船身、裡面木頭色、兩根橫桿，旁邊地上放一支槳 */
function canoe(world: THREE.Object3D, x: number, z: number, rot: number): void {
  const b = new Batch()
  const base = placed(x, z, rot)
  const hull = new THREE.MeshStandardMaterial({ color: 0xc8483c, roughness: 0.7, side: THREE.DoubleSide, flatShading: true })
  const inner = new THREE.MeshStandardMaterial({ color: 0xd9b98a, roughness: 0.9, side: THREE.DoubleSide, flatShading: true })
  const wood = flat(0x8a6238, 0.9)
  const shape = new THREE.Vector3(1.15, 0.28, 0.3)
  b.put(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hull, base, new THREE.Vector3(0, 0.28, 0), undefined, shape)
  b.put(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), inner, base, new THREE.Vector3(0, 0.285, 0), undefined, shape.clone().multiplyScalar(0.93))
  for (const sx of [-0.4, 0.35]) b.put(new THREE.BoxGeometry(0.07, 0.025, 0.5), wood, base, new THREE.Vector3(sx, 0.24, 0))
  // 槳：躺在船旁邊的沙上
  b.rod(wood, base, new THREE.Vector3(-0.6, 0.03, 0.5), new THREE.Vector3(0.45, 0.03, 0.58), 0.022, 0.022, 5)
  b.put(new THREE.BoxGeometry(0.34, 0.02, 0.13), wood, base, new THREE.Vector3(0.6, 0.03, 0.59), new THREE.Euler(0, -0.07, 0))
  b.build(world)
}

/** 小松樹：樹幹＋三層深綠圓錐 */
function pine(b: Batch, x: number, z: number, size: number): void {
  const base = placed(x, z, rand(0, Math.PI * 2), size)
  b.put(new THREE.CylinderGeometry(0.08, 0.11, 0.5, 6), flat(0x6e4a2c, 1), base, new THREE.Vector3(0, 0.25, 0))
  const leaf = [flat(0x3d7a4a, 0.9), flat(0x356e43, 0.9)]
  ;[
    [0.45, 0.66, 0.8],
    [0.92, 0.5, 0.72],
    [1.36, 0.33, 0.64],
  ].forEach(([y, r, h], i) => b.put(new THREE.ConeGeometry(r, h, 7), leaf[i % 2], base, new THREE.Vector3(0, y + h / 2, 0)))
}

/**
 * 蓋整個營地（ranch-scene.ts 的 build 呼叫）。回傳寵物要繞開的東西，以及要每格更新的營火
 */
export function buildCamp(world: THREE.Object3D, map: RanchMap): { obstacles: CampObstacle[]; fire: Campfire | null } {
  const obstacles: CampObstacle[] = []
  const layout = map.camp
  if (!layout) return { obstacles, fire: null }

  const [tx, tz] = layout.tent
  tent(world, tx, tz)
  // 帳篷長 1.9、斜放：沿著它的方向放兩個圓
  for (const t of [-0.45, 0.45]) obstacles.push({ x: tx + t * Math.SQRT1_2, z: tz + t * Math.SQRT1_2, r: 0.8 })

  const [fx, fz] = layout.fire
  const fire = new Campfire(fx, fz)
  world.add(fire.group)
  obstacles.push({ x: fx, z: fz, r: 0.42 })

  const b = new Batch()
  const id = new THREE.Matrix4()
  firePit(b, fx, fz)
  // 當椅子的木頭：躺著的一段粗樹幹，兩頭是淺色的切面
  const bark = flat(0x6c4a30, 1)
  const cut = flat(0xc9a06b, 1)
  for (const [x, z, rot] of layout.logs) {
    const base = placed(x, z, rot)
    b.put(new THREE.CylinderGeometry(0.17, 0.17, 0.95, 8), bark, base, new THREE.Vector3(0, 0.17, 0), new THREE.Euler(0, 0, Math.PI / 2))
    b.put(new THREE.CylinderGeometry(0.13, 0.13, 0.96, 8), cut, base, new THREE.Vector3(0, 0.17, 0), new THREE.Euler(0, 0, Math.PI / 2))
    obstacles.push({ x, z, r: 0.42 })
  }
  for (const [x, z, size] of layout.pines) {
    pine(b, x, z, size)
    obstacles.push({ x, z, r: 0.35 * size })
  }
  const rocks = [flat(0x8e8a80, 1), flat(0x7d7a72, 1)]
  layout.rocks.forEach(([x, z, s], i) => {
    b.put(new THREE.DodecahedronGeometry(s, 0), rocks[i % 2], id, new THREE.Vector3(x, s * 0.3, z), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
    b.put(new THREE.DodecahedronGeometry(s * 0.5, 0), rocks[(i + 1) % 2], id, new THREE.Vector3(x + s * 1.1, s * 0.15, z + s * 0.4), new THREE.Euler(rand(0, 3), rand(0, 3), 0), new THREE.Vector3(1, 0.7, 1))
    obstacles.push({ x, z, r: s * 0.85 })
  })
  b.build(world)

  const [cx, cz, crot] = layout.canoe
  canoe(world, cx, cz, crot)
  // 船身長 2.3：沿著船的方向放三個圓
  for (const t of [-0.7, 0, 0.7]) obstacles.push({ x: cx + Math.cos(crot) * t, z: cz - Math.sin(crot) * t, r: 0.4 })
  return { obstacles, fire }
}
