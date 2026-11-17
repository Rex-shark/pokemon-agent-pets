/**
 * 牧場的水域（2026-11-11 水系原型起；現在每張地圖的水在哪裡由 ranch-maps.ts 決定：湖、河）。
 *
 * - 形狀：由 RanchScene 給一個「水域距離」函式 field(x, z)：> 0 在水裡（數字是離水岸多遠），< 0 在岸上。
 *   湖底深淺、沙灘、能不能站，全部從它算，所以湖改形狀只要換函式。
 * - 湖底（bedY）：水岸線往外 BEACH_WIDTH 是露出水面的沙灘；往內 0 ～ SHELF 是淺灘（兩棲的可以站著涉水），再往內是深水（DEEP）。
 *   地形網格（RanchScene.buildIsland）的高度就是 bedY。
 * - 水面：半透明的平面（WATER_Y），不寫深度。寵物沉到水面以下的部分會被水面蓋一層藍色，看起來就是「泡在水裡」；
 *   露出水面的部分比水面近，水面畫不上去，所以不用另外裁切模型。
 * - 水波、水花：寵物在水裡時由 PetActor 呼叫 ripple、splash，這裡管動畫與回收（RanchScene.render 每格呼叫 update）。
 */
import * as THREE from 'three'

/** 水面高度（草地是 0） */
export const WATER_Y = -0.05
/** 沙灘寬度：水岸線往外這麼遠是沙灘，再往外是草地 */
export const BEACH_WIDTH = 0.55
/** 淺灘：離岸 0 ～ SHELF，湖底從水面斜到 SHELF_Y */
const SHELF = 0.7
const SHELF_Y = -0.42
/** 最深的地方（離岸 SHELF + 0.8 以後） */
const DEEP = -0.72

export type WaterField = (x: number, z: number) => number

export interface LakeOptions {
  field: WaterField
  /** 取樣範圍（隨機找水裡的點、擺裝飾用） */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** 水面的外框（世界的 x, z）；地形高過水面的地方自然會蓋住它 */
  surface: THREE.Vector2[]
  /** 水面顏色（雪地用偏冷的藍）；沒給就是一般的湖藍 */
  waterColor?: number
  /** 水面透明度；沒給是 0.6 */
  waterOpacity?: number
  /**
   * 湖底、海底的形狀用另一個函式（沒給就跟 field 一樣）。左側海用：看起來海水一路到小島邊緣，
   * 但寵物用的 field 在離邊緣一點點的地方就算岸，才不會游到小島外面
   */
  bedField?: WaterField
  /**
   * 地面額外的高度（火山口湖的火山）：加在湖底與地面上。沒給就是平的。
   * 要讓湖在山頂，湖和岸邊這裡要回傳跟 level 一樣的高度
   */
  elevation?: WaterField
  /** 水面比平常高多少（火山口湖的湖在山頂）；沒給是 0。有給的話 surface 要是湖自己的外框，不能是整座小島 */
  level?: number
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** 離岸距離 → 湖底高度（陸地是 0） */
export function bedOf(d: number): number {
  if (d <= -BEACH_WIDTH) return 0
  if (d <= 0) return WATER_Y * smooth((d + BEACH_WIDTH) / BEACH_WIDTH)
  if (d <= SHELF) return WATER_Y + (SHELF_Y - WATER_Y) * (d / SHELF)
  return SHELF_Y + (DEEP - SHELF_Y) * smooth((d - SHELF) / 0.8)
}

interface Ripple {
  mesh: THREE.Mesh
  age: number
  life: number
  from: number
  to: number
  opacity: number
}

interface Drop {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  age: number
  life: number
}

export class Lake {
  private readonly field: WaterField
  private readonly bedField: WaterField
  private readonly elevation: WaterField | undefined
  /** 水面比平常高多少（火山口湖）；一般的地圖是 0 */
  private readonly level: number
  private readonly bounds: LakeOptions['bounds']
  /** 水面、裝飾、水波都放在這裡（RanchScene 的 world：換地圖時整組拿掉） */
  private readonly scene: THREE.Object3D
  private readonly ripples: Ripple[] = []
  private readonly drops: Drop[] = []
  private readonly rippleGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2)
  private readonly dropGeo = new THREE.SphereGeometry(1, 6, 4)
  /** 水域裡離岸最遠的距離（窄的河很小）：大隻水系的離岸距離不能超過它 */
  readonly maxDist: number

  constructor(scene: THREE.Object3D, options: LakeOptions) {
    this.scene = scene
    this.field = options.field
    this.bedField = options.bedField ?? options.field
    this.elevation = options.elevation
    this.level = options.level ?? 0
    this.bounds = options.bounds
    let max = 0
    const { minX, maxX, minZ, maxZ } = options.bounds
    for (let x = minX; x <= maxX; x += 0.1) for (let z = minZ; z <= maxZ; z += 0.1) max = Math.max(max, options.field(x, z))
    this.maxDist = max

    // 水面：半透明、帶一點光澤（反射環境光）。形狀的 y 轉成水平後是世界的 -z，所以先把 z 反過來
    const water = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(options.surface.map((p) => new THREE.Vector2(p.x, -p.y)))).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: options.waterColor ?? 0x4fb2e3,
        transparent: true,
        opacity: options.waterOpacity ?? 0.6,
        roughness: 0.08,
        metalness: 0.05,
        depthWrite: false,
      }),
    )
    water.position.y = WATER_Y + this.level
    water.renderOrder = 1
    scene.add(water)
  }

  /** 離水岸多遠：> 0 在水裡、< 0 在岸上 */
  dist(x: number, z: number): number {
    return this.field(x, z)
  }

  /** 湖底（或沙灘、草地）的高度 */
  bedY(x: number, z: number): number {
    return bedOf(this.bedField(x, z)) + (this.elevation ? this.elevation(x, z) : 0)
  }

  /**
   * 這一點的水面高度。一般的地圖整張都是 WATER_Y；火山口湖只有湖和岸邊是抬高的水面，
   * 山下的平地還是 WATER_Y（不然平地比水面低，會被當成泡在水裡）
   */
  surfaceY(x: number, z: number): number {
    return this.level !== 0 && this.field(x, z) > -BEACH_WIDTH ? WATER_Y + this.level : WATER_Y
  }

  /** (x, z) 在水裡、而且離岸至少 margin */
  isWater(x: number, z: number, margin = 0): boolean {
    return this.field(x, z) > margin
  }

  /** 陸地上（草地，不在沙灘上），離沙灘至少 margin */
  isLand(x: number, z: number, margin = 0): boolean {
    return this.field(x, z) < -(BEACH_WIDTH + 0.1) - margin
  }

  /** 湖裡隨機一點（離岸 margin）；找不到夠深的就給找過最深的那一點 */
  randomWaterSpot(margin: number): THREE.Vector3 {
    const { minX, maxX, minZ, maxZ } = this.bounds
    let best = new THREE.Vector3()
    let bestD = -Infinity
    for (let i = 0; i < 300; i++) {
      const x = minX + Math.random() * (maxX - minX)
      const z = minZ + Math.random() * (maxZ - minZ)
      const d = this.field(x, z)
      if (d > margin) return new THREE.Vector3(x, 0, z)
      if (d > bestD) {
        bestD = d
        best = new THREE.Vector3(x, 0, z)
      }
    }
    return best
  }

  /** 往 field 變大（更深）的方向 */
  private gradient(x: number, z: number): THREE.Vector2 {
    const e = 0.05
    const g = new THREE.Vector2(this.field(x + e, z) - this.field(x - e, z), this.field(x, z + e) - this.field(x, z - e))
    return g.lengthSq() > 1e-10 ? g.normalize() : g
  }

  /** 把點拉進湖裡（離岸 margin） */
  clampInto(p: THREE.Vector3, margin: number): void {
    for (let i = 0; i < 4; i++) {
      const d = this.field(p.x, p.z)
      if (d >= margin) return
      const g = this.gradient(p.x, p.z)
      p.x += g.x * (margin - d + 0.01)
      p.z += g.y * (margin - d + 0.01)
    }
  }

  /** 把點推出湖外、沙灘外（陸地寵物被擠進水裡時） */
  pushOut(p: THREE.Vector3, margin: number): void {
    const limit = -(BEACH_WIDTH + 0.1) - margin
    for (let i = 0; i < 4; i++) {
      const d = this.field(p.x, p.z)
      if (d <= limit) return
      const g = this.gradient(p.x, p.z)
      p.x -= g.x * (d - limit + 0.01)
      p.z -= g.y * (d - limit + 0.01)
    }
  }

  /** 水波：一圈從 size 擴散到 size×2.2 的白色圓環 */
  ripple(x: number, z: number, size: number, opacity = 0.45): void {
    const mesh = new THREE.Mesh(
      this.rippleGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false }),
    )
    mesh.position.set(x, this.surfaceY(x, z) + 0.004, z)
    mesh.renderOrder = 2
    this.scene.add(mesh)
    this.ripples.push({ mesh, age: 0, life: 1.8, from: size, to: size * 2.2, opacity })
  }

  /** 入水、出水的水花：幾顆往上噴的水珠＋一圈大水波 */
  splash(x: number, z: number, size: number): void {
    this.ripple(x, z, size * 0.7, 0.6)
    this.ripple(x, z, size * 0.4, 0.5)
    const n = 10 + Math.round(size * 8)
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(
        this.dropGeo,
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xd8f1ff : 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      )
      const a = Math.random() * Math.PI * 2
      const r = size * (0.3 + Math.random() * 0.4)
      mesh.position.set(x + Math.cos(a) * r, this.surfaceY(x, z) + 0.02, z + Math.sin(a) * r)
      mesh.scale.setScalar(0.025 + Math.random() * 0.03 * (0.6 + size))
      mesh.renderOrder = 3
      const out = 0.6 + Math.random() * 0.9
      const vel = new THREE.Vector3(Math.cos(a) * out, 1.6 + Math.random() * 1.4 * (0.6 + size * 0.5), Math.sin(a) * out)
      this.scene.add(mesh)
      this.drops.push({ mesh, vel, age: 0, life: 0.9 + Math.random() * 0.4 })
    }
  }

  update(dt: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.age += dt
      const t = r.age / r.life
      if (t >= 1) {
        r.mesh.removeFromParent()
        ;(r.mesh.material as THREE.Material).dispose()
        this.ripples.splice(i, 1)
        continue
      }
      const k = 1 - (1 - t) * (1 - t)
      const size = r.from + (r.to - r.from) * k
      r.mesh.scale.set(size, 1, size)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = r.opacity * (1 - t)
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]
      d.age += dt
      d.vel.y -= 7 * dt
      d.mesh.position.addScaledVector(d.vel, dt)
      const t = d.age / d.life
      if (t >= 1 || d.mesh.position.y < WATER_Y + this.level - 0.05) {
        d.mesh.removeFromParent()
        ;(d.mesh.material as THREE.Material).dispose()
        this.drops.splice(i, 1)
        continue
      }
      ;(d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t * t)
    }
  }

  /** 隨機找一點，離岸距離在 [lo, hi] 之間 */
  private spotBetween(lo: number, hi: number, accept: (x: number, z: number) => boolean = () => true): THREE.Vector3 | null {
    const { minX, maxX, minZ, maxZ } = this.bounds
    for (let i = 0; i < 400; i++) {
      const x = minX + Math.random() * (maxX - minX)
      const z = minZ + Math.random() * (maxZ - minZ)
      const d = this.field(x, z)
      if (d >= lo && d <= hi && accept(x, z)) return new THREE.Vector3(x, 0, z)
    }
    return null
  }

  /** 裝飾：睡蓮葉、岸邊的石頭、後岸的蘆葦（都很小，不擋寵物）。edgeOk：離小島外緣夠遠（不要放到泥土邊上） */
  buildDecor(edgeOk: (x: number, z: number) => boolean): void {
    const padMat = new THREE.MeshStandardMaterial({ color: 0x5fa845, roughness: 0.8, side: THREE.DoubleSide })
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffb3d1, roughness: 0.6 })
    for (let i = 0; i < 6; i++) {
      const p = this.spotBetween(0.25, 0.75)
      if (!p) continue
      const r = 0.13 + Math.random() * 0.08
      const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 20, 0.35, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2), padMat)
      pad.position.set(p.x, WATER_Y + 0.006, p.z)
      pad.rotation.y = Math.random() * 6
      pad.renderOrder = 2
      this.scene.add(pad)
      if (r > 0.17) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), flowerMat)
        f.position.set(p.x, WATER_Y + 0.04, p.z)
        this.scene.add(f)
      }
    }

    const rockMat = new THREE.MeshStandardMaterial({ color: 0xa9a294, roughness: 1, flatShading: true })
    for (let i = 0; i < 6; i++) {
      const p = this.spotBetween(-0.4, -0.12, edgeOk)
      if (!p) continue
      const r = 0.08 + Math.random() * 0.08
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat)
      rock.position.set(p.x, this.bedY(p.x, p.z) + r * 0.3, p.z)
      rock.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      rock.scale.y = 0.6
      this.scene.add(rock)
    }

    // 蘆葦：後半邊岸邊（z < 0）幾叢，不擋前面
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b9a3e, roughness: 1 })
    const headMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 })
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.5, 4)
    const headGeo = new THREE.CapsuleGeometry(0.03, 0.09, 2, 6)
    for (let c = 0; c < 3; c++) {
      const center = this.spotBetween(-0.15, 0.08, (x, z) => z < -1 && edgeOk(x, z))
      if (!center) continue
      for (let i = 0; i < 3; i++) {
        const x = center.x + (Math.random() - 0.5) * 0.25
        const z = center.z + (Math.random() - 0.5) * 0.25
        const h = 0.4 + Math.random() * 0.2
        const base = this.bedY(x, z)
        const stem = new THREE.Mesh(stemGeo, stemMat)
        stem.scale.y = h / 0.5
        stem.position.set(x, base + h / 2, z)
        stem.rotation.z = (Math.random() - 0.5) * 0.2
        const head = new THREE.Mesh(headGeo, headMat)
        head.position.set(x, base + h, z)
        this.scene.add(stem, head)
      }
    }
  }
}
