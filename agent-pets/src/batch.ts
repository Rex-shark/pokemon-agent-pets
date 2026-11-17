/**
 * 蓋場景擺設用的小工具（beach.ts、sakura.ts、snow.ts 共用）：把同一種材質的零件合併成一個網格，一棵樹幾十個零件只畫幾次。
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** 同一種材質的零件收在一起，最後合併成一個網格（一棵樹幾十團花只畫幾次） */
export class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>()

  /** 加一個零件：geo 會被這裡拿去用（轉成不帶索引、套上 matrix），呼叫的人不要再留著 */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo
    if (g !== geo) geo.dispose()
    g.applyMatrix4(matrix)
    const list = this.parts.get(mat)
    if (list) list.push(g)
    else this.parts.set(mat, [g])
  }

  /** 位置＋轉角（先轉再移）＋縮放 */
  put(geo: THREE.BufferGeometry, mat: THREE.Material, base: THREE.Matrix4, pos: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3): void {
    const q = new THREE.Quaternion()
    if (rot) q.setFromEuler(rot)
    this.add(geo, mat, new THREE.Matrix4().compose(pos, q, scale ?? new THREE.Vector3(1, 1, 1)).premultiply(base))
  }

  /** 從 a 到 b 的一根圓柱（樹幹、枝幹、欄杆） */
  rod(mat: THREE.Material, base: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sides = 7): void {
    const dir = b.clone().sub(a)
    const len = dir.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    const mid = a.clone().add(b).multiplyScalar(0.5)
    this.add(new THREE.CylinderGeometry(rb, ra, len, sides), mat, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)).premultiply(base))
  }

  build(parent: THREE.Object3D): void {
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false)
      for (const g of list) g.dispose()
      if (merged) parent.add(new THREE.Mesh(merged, mat))
    }
    this.parts.clear()
  }
}

/** 位置在 (x, 0, z)、繞 y 轉 rot、整體縮放 s 的矩陣 */
export function placed(x: number, z: number, rot = 0, s = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(s, s, s))
}

export function flat(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true })
}
