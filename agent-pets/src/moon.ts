/**
 * 月面基地地圖的東西（2026-11-16 使用者「新增一個地圖：月面基地。土地是月面，然後有兩個半圓形玻璃罩罩著場地，中間有通道，
 * 一個半圓是水。玻璃罩外面放兩個皮皮跟 1 隻皮可西當 NPC，隨機動作」；ranch-maps.ts 的 moon）。
 * 同一天改成一個大罩子（使用者「改為一個大罩子」），罩外的月面加上起伏與更明顯的隕石坑（「坑洞有凹凸起伏」）。
 *
 * - 地面：整座小島是灰色的月面；罩外緩緩起伏、有隕石坑（坑底暗、坑緣亮；高低在 ranch-maps.ts 的 elevation）
 * - 一個大玻璃罩：壓扁的半球、淡淡的透明藍，底下一圈金屬底座、幾道肋條，罩頂一個小蓋子；罩子正中央有一座圓形水池
 * - 通道：罩子往畫面左下接一段半圓筒的玻璃走廊，通到小島邊緣，盡頭一扇有圓窗的金屬門（使用者「左邊加上一個通道能到場地邊緣，然後邊緣做一個門」）
 * - 寵物都在罩子和通道裡面（RanchMap.noGo 把外面擋掉）；罩外是 NPC 的地方（RanchMap.npcZone）
 * - 罩外只放一面旗子和一座小天線，其他不放
 *
 * 都用程式產生，不用圖檔。罩子與水池的位置與大小在 ranch-maps.ts 的 MoonBase。
 */
import * as THREE from 'three'

import { Batch, flat } from './batch'
import { moonPoolOutline, moonTunnelDist, type MoonBase, type RanchMap } from './ranch-maps'

/** 月面的配色（ranch-scene.ts 的 buildIsland 用） */
export const MOON_GROUND = {
  /** 月面的兩種深淺、隕石坑裡面、罩子裡的地板 */
  dust: 0xa6a8b1,
  dust2: 0x989aa4,
  crater: 0x7c7f89,
  floor: 0xc6c9d2,
  /** 水池的池邊、淺水與深水的池底 */
  shore: 0xd4d8e0,
  bedShallow: 0x9fe0ee,
  bedDeep: 0x2f86b8,
  /** 小島側面 */
  cliff: 0x7c7d85,
}
export const MOON_WATER = 0x56c4ea
export const MOON_WATER_OPACITY = 0.55

const smooth = THREE.MathUtils.smoothstep

/** 寵物要繞開的圓（跟 ranch-scene.ts 的 Obstacle 一樣） */
export interface MoonObstacle {
  x: number
  z: number
  r: number
}

const palette = {
  dust: new THREE.Color(MOON_GROUND.dust),
  dust2: new THREE.Color(MOON_GROUND.dust2),
  crater: new THREE.Color(MOON_GROUND.crater),
  floor: new THREE.Color(MOON_GROUND.floor),
  shore: new THREE.Color(MOON_GROUND.shore),
  shallow: new THREE.Color(MOON_GROUND.bedShallow),
  deep: new THREE.Color(MOON_GROUND.bedDeep),
}

/**
 * 地面一個頂點的顏色（ranch-scene.ts 的 buildIsland 每個頂點呼叫一次，結果寫進 c）。
 * d：水域距離（> 0 在水裡）；y：這一點的地面高度（隕石坑裡是負的）
 */
export function moonGroundColor(base: MoonBase, x: number, z: number, d: number, y: number, c: THREE.Color): void {
  if (d > 0) {
    c.copy(palette.shore).lerp(palette.shallow, smooth(d, 0, 0.4))
    c.lerp(palette.deep, smooth(d, 0.5, 1.8))
    return
  }
  if (d > -0.55) {
    c.copy(palette.shore)
    return
  }
  c.copy(palette.dust).lerp(palette.dust2, 0.5 + 0.5 * Math.sin(x * 1.7 + z * 0.6) * Math.sin(z * 1.9 - x * 0.4))
  // 隕石坑與起伏：低的地方暗（坑底最暗）、高的地方亮（坑緣、土丘頂），看得出凹凸
  c.lerp(palette.crater, smooth(-y, 0.03, 0.26))
  c.lerp(palette.floor, 0.65 * smooth(y, 0.03, 0.12))
  // 罩子和通道裡面：顏色淡一點、乾淨一點的地板
  const inside = Math.min(Math.hypot(x - base.dome.x, z - base.dome.z) - base.dome.r, moonTunnelDist(base, x, z) - base.tunnel.half)
  c.lerp(palette.floor, 0.75 * (1 - smooth(inside, -0.25, 0)))
}

/**
 * 玻璃：淡淡的透明藍，不寫深度（裡面的寵物照常畫），排在水面之後畫。
 * 2026-11-16 使用者「場地玻璃加上一些些透明藍（一點點透）」：原本幾乎是白的（0xcfeeff、不透明度 0.15～0.2），
 * 改成看得出藍色、但裡面的寵物還是看得清楚
 */
function glass(opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x8fcaf2, transparent: true, opacity, roughness: 0.08, metalness: 0.1, depthWrite: false })
}

/**
 * 蓋月面基地（ranch-scene.ts 的 build 呼叫）：一個大玻璃罩、罩外的旗子與天線。回傳寵物與 NPC 要繞開的東西。
 * groundY：這一點的地面高度（罩外有起伏與隕石坑）
 */
export function buildMoonBase(world: THREE.Object3D, map: RanchMap, groundY: (x: number, z: number) => number): MoonObstacle[] {
  const obstacles: MoonObstacle[] = []
  const base = map.moonBase
  if (!base) return obstacles
  const b = new Batch()
  const id = new THREE.Matrix4()
  const metal = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.35, metalness: 0.6 })
  const dark = flat(0x596070, 0.6)
  const { dome, height } = base
  const squash = height / dome.r

  // 罩子：壓扁的半球，外面一層玻璃
  const shell = new THREE.Mesh(new THREE.SphereGeometry(dome.r, 56, 18, 0, Math.PI * 2, 0, Math.PI / 2), glass(0.22))
  shell.position.set(dome.x, 0, dome.z)
  shell.scale.y = squash
  shell.renderOrder = 6
  world.add(shell)
  // 底座：一圈金屬環
  b.put(new THREE.TorusGeometry(dome.r, 0.1, 8, 96), metal, id, new THREE.Vector3(dome.x, 0.06, dome.z), new THREE.Euler(Math.PI / 2, 0, 0))
  // 肋條：四道過頂的弧，加上半高的一圈
  for (let k = 0; k < 4; k++) {
    b.put(new THREE.TorusGeometry(dome.r, 0.03, 5, 56, Math.PI), metal, id, new THREE.Vector3(dome.x, 0, dome.z), new THREE.Euler(0, (k * Math.PI) / 4, 0), new THREE.Vector3(1, squash, 1))
  }
  const midR = dome.r * Math.cos(Math.PI / 4)
  b.put(new THREE.TorusGeometry(midR, 0.026, 5, 72), metal, id, new THREE.Vector3(dome.x, height * Math.sin(Math.PI / 4), dome.z), new THREE.Euler(Math.PI / 2, 0, 0))
  // 罩頂一個小小的金屬蓋
  b.put(new THREE.CylinderGeometry(0.3, 0.4, 0.12, 14), metal, id, new THREE.Vector3(dome.x, height + 0.02, dome.z))
  // 水池：池邊一圈矮矮的金屬框
  const rim = moonPoolOutline(base, 64, 0.14).map((p) => new THREE.Vector3(p.x, 0.03, p.y))
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true, 'centripetal'), 240, 0.05, 6, true), metal, id)

  // 通道：半圓筒的玻璃走廊，從罩子邊緣（往裡伸一點，接縫藏在罩子裡）到門；每隔一段一圈肋、兩側底下一條金屬邊
  const { half } = base.tunnel
  const [tx0, tz0] = base.tunnel.from
  const [tx1, tz1] = base.tunnel.to
  const tlen = Math.hypot(tx1 - tx0, tz1 - tz0)
  const ux = (tx1 - tx0) / tlen
  const uz = (tz1 - tz0) / tlen
  const from = dome.r - 0.35
  const to = tlen
  const mid = (from + to) / 2
  /** 通道的座標：local x 沿通道往門、原點在通道中段的地面 */
  const tunnelAt = new THREE.Matrix4().compose(new THREE.Vector3(tx0 + ux * mid, 0, tz0 + uz * mid), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(uz, ux)), new THREE.Vector3(1, 1, 1))
  /** 圓柱（軸是 y）轉成沿 local x、只留地面以上的半邊 */
  const lieDown = new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(half, half, to - from, 24, 1, true, 0, Math.PI), glass(0.26))
  tube.applyMatrix4(lieDown.clone().premultiply(tunnelAt))
  tube.renderOrder = 6
  world.add(tube)
  const ribs = Math.max(2, Math.round((to - from) / 1.1))
  for (let i = 0; i <= ribs; i++) {
    const t = from - mid + ((to - from) * i) / ribs
    b.put(new THREE.TorusGeometry(half, i === ribs ? 0.07 : 0.03, 6, 28, Math.PI), i === ribs ? dark : metal, tunnelAt, new THREE.Vector3(t, 0, 0), new THREE.Euler(0, Math.PI / 2, 0))
  }
  for (const side of [-1, 1]) b.put(new THREE.BoxGeometry(to - from, 0.1, 0.1), metal, tunnelAt, new THREE.Vector3(0, 0.05, side * half))
  // 門：通道盡頭一片半圓的金屬門板，中間一道縫，上面一扇圓窗、門邊一盞橘色的燈
  const doorAt = new THREE.Matrix4().makeTranslation(to - mid - 0.04, 0, 0).premultiply(tunnelAt)
  const door = new THREE.Matrix4().multiplyMatrices(doorAt, lieDown)
  b.add(new THREE.CylinderGeometry(half - 0.02, half - 0.02, 0.06, 28, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x7d889a, roughness: 0.45, metalness: 0.55 }), door)
  b.put(new THREE.BoxGeometry(0.075, half * 0.9, 0.025), dark, doorAt, new THREE.Vector3(0.0, half * 0.45, 0))
  b.put(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 18), new THREE.MeshStandardMaterial({ color: 0x9fd8f2, roughness: 0.1, metalness: 0.2 }), doorAt, new THREE.Vector3(0, half * 0.62, 0), new THREE.Euler(0, 0, Math.PI / 2))
  b.put(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a10, emissiveIntensity: 0.9 }), doorAt, new THREE.Vector3(-0.02, half + 0.05, 0))

  // 旗子：一根桿子、一面白底藍邊的小旗
  const [fx, fz] = base.flag
  const fy = groundY(fx, fz)
  b.rod(metal, id, new THREE.Vector3(fx, fy, fz), new THREE.Vector3(fx, fy + 1.5, fz), 0.03, 0.025, 6)
  b.put(new THREE.BoxGeometry(0.62, 0.38, 0.02), flat(0xf7f7fa, 0.8), id, new THREE.Vector3(fx + 0.33, fy + 1.28, fz))
  b.put(new THREE.BoxGeometry(0.62, 0.09, 0.025), flat(0x3f6fd0, 0.8), id, new THREE.Vector3(fx + 0.33, fy + 1.13, fz))
  obstacles.push({ x: fx, z: fz, r: 0.2 })

  // 天線：三腳架上一個朝天的碟子
  const [ax, az] = base.antenna
  const ay = groundY(ax, az)
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI * 2
    b.rod(dark, id, new THREE.Vector3(ax + Math.cos(ang) * 0.32, ay, az + Math.sin(ang) * 0.32), new THREE.Vector3(ax, ay + 0.55, az), 0.03, 0.03, 5)
  }
  b.rod(metal, id, new THREE.Vector3(ax, ay + 0.5, az), new THREE.Vector3(ax, ay + 0.95, az), 0.035, 0.035, 6)
  b.put(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), id, new THREE.Vector3(ax, ay + 1.38, az), new THREE.Euler(Math.PI - 0.5, 0.6, 0))
  obstacles.push({ x: ax, z: az, r: 0.45 })

  b.build(world)
  return obstacles
}
