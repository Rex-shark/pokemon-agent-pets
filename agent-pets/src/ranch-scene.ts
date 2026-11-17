/**
 * 牧場場景（three.js）：透明背景上一塊圓角正方形的小島，上面有水（湖或河，lake.ts）、草地圍木柵欄、幾棵樹、零星的花。
 * 全部用程式產生，不用額外的素材檔。
 *
 * 鏡頭：等角（iso-view.ts）——正交、水平轉 45°、往下看 30°，小島在畫面上是一塊菱形，遠近一樣大。
 * 2026-11-12 使用者：原本的透視鏡頭與那組長方形地圖（含全背景）都拿掉；現在有八張地圖（ranch-maps.ts；第八張海底世界是 2026-11-17 加的，undersea.ts，中間罩子裡是陸地、罩外是海；第七張月面基地是 2026-11-16 加的，moon.ts；第六張中央島是 2026-11-13 加的，跟左側海共用 beach.ts）：
 * 左側海（beach.ts，海灘）、火山口湖（volcano.ts，原本的中央湖）、中央河（camp.ts，河畔露營）、雪地（snow.ts）、日式賞櫻（sakura.ts，池泉庭園）。
 *
 * 座標：y 朝上，草地表面在 y = 0；鏡頭在右前方（+x、+z）往下斜看。小島大小與地圖在 ranch-maps.ts；setMap 換地圖時把 world 整組重蓋。
 * 地面是一張高度網格：草地 y = 0，水的地方照 lake.ts 的 bedOf 往下挖（沙灘、淺灘、深水）。
 * 陸地的寵物不下水、水中的只在水裡、兩棲的都可以（habitat.ts）。
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import type { IslandFrame, RanchMapId } from '../shared/ranch-protocol'
import type { Habitat } from './habitat'
import { IsoView } from './iso-view'
import { buildCamp } from './camp'
import { BEACH_GROUND, BEACH_WATER, BEACH_WATER_OPACITY, buildBeach } from './beach'
import { BEACH_WIDTH, Lake, WATER_Y } from './lake'
import { BACK, CZ, DEFAULT_MAP, edgeDist, HX, HZ, MAPS, onPier, outline, pierDeckY, RANCH, type RanchMap } from './ranch-maps'
import { buildSakuraGarden, PETAL_GROUND, PETAL_LOOK, SAKURA_FLOWERS, SAKURA_GROUND, SAKURA_WATER, SAKURA_WATER_OPACITY, SAKURA_WOOD } from './sakura'
import { buildMoonBase, MOON_GROUND, MOON_WATER, MOON_WATER_OPACITY, moonGroundColor } from './moon'
import { buildUndersea, UNDERSEA_GROUND, underseaGroundColor } from './undersea'
import { buildVolcano, VOLCANO_GROUND, VOLCANO_WATER, VOLCANO_WATER_OPACITY, VOLCANO_WOOD, volcanoGroundColor } from './volcano'
import { buildIceFloes, buildSnowMounds, buildSnowVillage, SNOW_GROUND, SNOW_WATER, SNOW_WATER_OPACITY, SNOW_WOOD, Snowfall, snowCap } from './snow'

/** 柵欄離小島外緣多遠 */
const FENCE_INSET = 0.35
/** 入口（木門）寬度的一半：柵欄正前方 |x| < GATE_HALF 的地方不圍柵欄，放木門 */
const GATE_HALF = 0.9
/** 木門打開的角度（弧度，0 = 關著；2026-11-12 使用者：都改成關著） */
const GATE_OPEN = 0
/** 寵物（的中心）離小島外緣至少多遠，留一圈給柵欄 */
const WALK_INSET = 0.85
/** 檢查路線時每隔多遠看一次（要比最窄的水面窄） */
const PATH_STEP = 0.3

/** 要去哪一種地方：陸地、水裡 */
export type Terrain = 'land' | 'water'

/** 寵物要繞開的東西（圓形） */
interface Obstacle {
  x: number
  z: number
  r: number
}

export class RanchScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  /** 等角鏡頭（泡泡投影、滑鼠點選、寵物面向鏡頭都用這個） */
  private readonly iso = new IsoView()
  readonly camera: THREE.OrthographicCamera = this.iso.camera
  /** 地面、水、柵欄、樹、花：換地圖時整組拿掉重蓋（寵物不在這裡面） */
  private readonly world = new THREE.Group()
  private map!: RanchMap
  /** 雪地的飄雪、賞櫻的飄花瓣（snow.ts 的 Snowfall）；其他地圖是 null */
  private snowfall: Snowfall | null = null
  /** 其他每格要更新的東西（火山口湖噴氣孔的煙）；換地圖時清掉 */
  private animated: { update(dt: number): void }[] = []
  /** 滑鼠判斷「在不在牧場上」用的地面網格 */
  ground!: THREE.Mesh
  lake!: Lake
  private obstacles: Obstacle[] = []
  /** 取景（主行程依模式給：置頂撐滿視窗、桌布放在螢幕中間偏下） */
  private frame: IslandFrame = { width: 0.96, bottom: 0.985, top: 0.3 }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05

    // 寶可夢的材質是 PBR：給一個柔和的室內環境光，金屬感、光澤才不會死黑
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    pmrem.dispose()

    this.scene.add(new THREE.HemisphereLight(0xfff6e5, 0x6b8f4e, 1.4))
    // 太陽在左後上方（DirectionalLight 只看方向，距離不影響亮度）
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(-5.6, 12.6, 8.4)
    this.scene.add(sun)

    this.scene.add(this.world)
    this.build(MAPS[DEFAULT_MAP])
    this.resize()
  }

  /** 海底世界：水系浮在海床上多高的範圍（pet-actor.ts）；不是海底世界回 null */
  get seaFloat(): [number, number] | null {
    return this.map.undersea?.float ?? null
  }

  /** 海底世界的海面高度（大隻的水系浮起來時頭不能冒出海面）；不是海底世界回 null */
  get seaSurface(): number | null {
    return this.map.undersea?.surface ?? null
  }

  get mapId(): RanchMapId {
    return this.map.id
  }

  /** 換地圖（拿到主行程的設定後呼叫）：world 整組拿掉重蓋。已經在牧場上的寵物要自己重新找位置 */
  setMap(id: RanchMapId): void {
    if (id === this.map.id || !MAPS[id]) return
    this.world.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
    })
    this.world.clear()
    this.obstacles = []
    this.build(MAPS[id])
  }

  private build(map: RanchMap): void {
    this.map = map
    const snow = map.theme === 'snow'
    const sakura = map.theme === 'sakura'
    const beach = map.theme === 'beach'
    const volcano = map.theme === 'volcano'
    const moon = map.theme === 'moon'
    const undersea = map.theme === 'undersea'
    const bounds = { minX: -HX, maxX: HX, minZ: BACK, maxZ: RANCH.front }
    this.animated = []
    this.lake = new Lake(this.world, {
      field: map.water,
      bedField: map.seabed,
      elevation: map.elevation,
      level: map.waterLevel,
      bounds,
      // 海（map.seabed）：水面畫到小島邊緣；湖和河往內縮一點，藏在邊緣那圈沙灘底下；山頂的湖（map.waterOutline）只鋪湖自己那一片
      surface: map.waterOutline ?? outline(map.seabed ? 0.01 : 0.2, 240),
      waterColor: snow ? SNOW_WATER : sakura ? SAKURA_WATER : beach ? BEACH_WATER : volcano ? VOLCANO_WATER : moon ? MOON_WATER : undefined,
      waterOpacity: snow ? SNOW_WATER_OPACITY : sakura ? SAKURA_WATER_OPACITY : beach ? BEACH_WATER_OPACITY : volcano ? VOLCANO_WATER_OPACITY : moon ? MOON_WATER_OPACITY : undefined,
      // 海底世界：平常那層水面藏起來（整座島沉在海裡，海面另外畫在高處，undersea.ts）
      ...(undersea ? { waterOpacity: 0 } : {}),
    })
    this.ground = this.buildIsland()
    this.buildFence()
    this.snowfall = null
    if (undersea) {
      // 海底世界（undersea.ts）：玻璃罩、海面與水牆、珊瑚、海草、寶箱、氣泡、魚群、光柱；罩子裡照一般地圖長樹、草叢、花（只長在陸地上，也就是罩子裡）
      this.obstacles.push(...buildUndersea(this.world, map, (x, z) => this.lake.bedY(x, z), this.animated))
      for (const [x, z, size] of map.trees) this.buildTree(x, z, size)
      this.buildTufts()
      this.buildFlowers()
      return
    }
    if (moon) {
      // 月面基地（moon.ts）：一個大玻璃罩、罩外的旗子與天線；沒有樹、草叢、花、睡蓮
      this.obstacles.push(...buildMoonBase(this.world, map, (x, z) => this.lake.bedY(x, z)))
      return
    }
    if (volcano) {
      // 火山口湖（volcano.ts）：火口緣與山坡的石頭、噴氣孔的煙、平地的枯樹與火山岩；沒有草叢、花、睡蓮
      const built = buildVolcano(this.world, map, (x, z) => this.lake.bedY(x, z))
      this.obstacles.push(...built.obstacles)
      this.animated.push(built.steam)
      return
    }
    if (snow) {
      // 雪地（snow.ts）：松林、小木屋、雪屋、路燈、白樺、雪人、浮冰、雪丘、飄雪；不長草叢和花，湖邊沒有睡蓮與蘆葦
      this.obstacles.push(...buildSnowVillage(this.world, map))
      buildIceFloes(this.world, map.water, bounds)
      buildSnowMounds(this.world, () => this.randomSpot(0.3))
      this.snowfall = new Snowfall({ minX: -HX - 1, maxX: HX + 1, minZ: BACK - 1, maxZ: RANCH.front + 1, top: 10 })
      this.world.add(this.snowfall.points)
      return
    }
    if (sakura) {
      // 賞櫻（sakura.ts）：櫻花樹、枝垂櫻、太鼓橋、鳥居、小祠、瀑布石組與鹿威し（會動，放進 animated）、後岸的松與石組、飛石、石燈籠、油菜花、落花與花筏、飄花瓣；
      // 草叢、零星小花、睡蓮蘆葦照常（草叢與小花比較少、顏色比較淡）
      this.obstacles.push(...buildSakuraGarden(this.world, map, (x, z) => this.lake.isLand(x, z) && edgeDist(x, z) > 0.4, this.animated))
      this.snowfall = new Snowfall({ minX: -HX, maxX: HX, minZ: BACK, maxZ: RANCH.front, top: 7 }, 150, PETAL_LOOK)
      this.world.add(this.snowfall.points)
    } else if (beach) {
      // 海灘（beach.ts）：椰子樹、木棧橋、小船、沙堡、海灘球、衝浪板、石頭、海星貝殼；海裡不放睡蓮和蘆葦
      this.obstacles.push(
        ...buildBeach(
          this.world,
          map,
          () => {
            const x = (Math.random() * 2 - 1) * HX
            const z = CZ + (Math.random() * 2 - 1) * HZ
            const d = map.water(x, z)
            // 棧橋的斜坡底下不撒（會從木板縫裡冒出來）
            return this.isSand(x, z) && d < -0.25 && d > -2.6 && edgeDist(x, z) > 0.6 && !map.offLimits?.(x, z) && this.deckY(x, z) === null ? [x, z] : null
          },
          (x, z) => this.lake.bedY(x, z),
        ),
      )
    } else {
      for (const [x, z, size] of map.trees) this.buildTree(x, z, size)
      // 中央河（camp.ts）：上岸沙地上的營地（帳篷、營火、獨木舟、小松樹）
      if (map.camp) {
        const built = buildCamp(this.world, map)
        this.obstacles.push(...built.obstacles)
        if (built.fire) this.animated.push(built.fire)
      }
    }
    if (!beach) this.lake.buildDecor((x, z) => edgeDist(x, z) > 0.5)
    this.buildTufts()
    this.buildFlowers()
    if (map.sand) this.buildPebbles()
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    // 視窗搬到縮放比例不同的螢幕（Retina ↔ 1080p）：以前靠整頁重新載入更新，現在不重載了，要自己跟上
    if (this.renderer.getPixelRatio() !== window.devicePixelRatio) this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(w, h, false)
    this.frameIsland(w, h)
  }

  /** 取景（iso-view.ts）：小島左右撐到 frame.width、底部在 NDC 的 -frame.bottom、上方留空間給泡泡 */
  protected frameIsland(w: number, h: number): void {
    this.iso.fit(w, h, this.frame)
  }

  /** 換取景（拿到主行程的設定後呼叫） */
  setFrame(frame: IslandFrame): void {
    this.frame = frame
    this.resize()
  }

  private lastRender = 0

  /** 畫一格；水波、水花也在這裡動（展示網站 showcase/intro.ts 也只呼叫 render，不用另外接） */
  render(): void {
    const now = performance.now()
    const dt = this.lastRender ? Math.min((now - this.lastRender) / 1000, 0.1) : 0
    this.lastRender = now
    this.lake.update(dt)
    this.snowfall?.update(dt)
    for (const a of this.animated) a.update(dt)
    this.renderer.render(this.scene, this.camera)
  }

  /** 牧場裡隨機一個可以站的點：terrain 'land' 避開水、樹；'water' 在水裡、離岸 margin */
  randomSpot(margin = 0.45, terrain: Terrain = 'land'): THREE.Vector3 {
    if (terrain === 'water') return this.lake.randomWaterSpot(margin)
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() * 2 - 1) * HX
      const z = CZ + (Math.random() * 2 - 1) * HZ
      if (this.isFree(x, z, margin)) return new THREE.Vector3(x, 0, z)
    }
    // 隨機抽 60 次都沒抽中（能站的地方很小，例如月面基地只有罩子裡）：從中間往外一圈圈找第一個能站的點。
    // 以前這裡直接回 (3, 1)，那一點在某些地圖上不能站（月面基地的罩子外面），寵物會生在不該在的地方
    // （2026-11-16 使用者「能保證新生成的寶可夢在罩子裡？」）
    for (let r = 0; r <= Math.max(HX, HZ); r += 0.25) {
      const n = Math.max(1, Math.round((r * Math.PI * 2) / 0.25))
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = CZ + Math.sin(a) * r
        if (this.isFree(x, z, margin)) return new THREE.Vector3(x, 0, z)
      }
    }
    return new THREE.Vector3(0, 0, CZ)
  }

  /** 陸地上可以站（在柵欄內、不在水裡或沙灘上、不撞樹） */
  isFree(x: number, z: number, margin: number): boolean {
    return this.inFence(x, z) && this.lake.isLand(x, z, margin * 0.5) && !this.map.offLimits?.(x, z) && !this.map.noGo?.(x, z) && this.clearOfObstacles(x, z, margin)
  }

  private inFence(x: number, z: number): boolean {
    return edgeDist(x, z) >= WALK_INSET
  }

  private clearOfObstacles(x: number, z: number, margin: number): boolean {
    return this.obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + margin)
  }

  /** 這一點這種寵物能不能去 */
  canStand(x: number, z: number, margin: number, habitat: Habitat): boolean {
    if (habitat === 'water') return this.lake.isWater(x, z, margin)
    // 陸地：草地與沙地，加上棧橋的橋面（底下是水，isFree 不算）
    if (habitat === 'land') return this.onDeck(x, z) || this.isFree(x, z, margin)
    // 兩棲：柵欄內、不撞樹就好（水陸都能去）；誰都不能去的地方（火山的山坡、山後面、棧橋的兩側）除外
    return this.inFence(x, z) && !this.map.noGo?.(x, z) && this.clearOfObstacles(x, z, margin)
  }

  /** 在不在棧橋上寵物能站的那一條（這張地圖沒有棧橋就是 false） */
  private onDeck(x: number, z: number): boolean {
    return !!this.map.pier && onPier(this.map.pier, x, z) && this.inFence(x, z)
  }

  /** 這一點如果在棧橋的橋面上，橋面多高；不在回 null（PetActor 用它決定腳底的高度） */
  deckY(x: number, z: number): number | null {
    return this.map.pier ? pierDeckY(this.map.pier, x, z) : null
  }

  /** 棧橋上隨機一個能站的點（伸進海裡的那一段）；這張地圖沒有棧橋回 null */
  pierSpot(): THREE.Vector3 | null {
    const pier = this.map.pier
    if (!pier) return null
    for (let i = 0; i < 12; i++) {
      const x = pier.x0 + Math.random() * (pier.x1 - pier.ramp - pier.x0)
      const z = pier.z + (Math.random() * 2 - 1) * pier.half
      if (this.onDeck(x, z)) return new THREE.Vector3(x, 0, z)
    }
    return null
  }

  /**
   * 從 a 到 b 要依序走過哪些點：直線走得到就只有 b；走不到回 null。
   * 棧橋只有岸上那一頭能上下，一頭在橋上、一頭不在的時候直線會穿過橋邊，改成先走到橋頭再過去
   */
  route(a: THREE.Vector3, b: THREE.Vector3, margin: number, habitat: Habitat): THREE.Vector3[] | null {
    if (this.pathClear(a, b, margin, habitat)) return [b]
    const pier = this.map.pier
    if (!pier || habitat === 'water' || this.onDeck(a.x, a.z) === this.onDeck(b.x, b.z)) return null
    const head = new THREE.Vector3(pier.x1 + 0.45, 0, pier.z)
    return this.pathClear(a, head, margin, habitat) && this.pathClear(head, b, margin, habitat) ? [head, b] : null
  }

  /**
   * NPC（不屬於任何 session，例如月面基地罩外的皮皮）活動的範圍：這張地圖沒有就回 null。
   * 給 PetActor 當 Roam 用：挑目的地、被擠出去時拉回來、檢查直線走不走得到
   */
  npcRoam(): { spot(): THREE.Vector3; clamp(p: THREE.Vector3): void; route(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] | null } | null {
    const zone = this.map.npcZone
    if (!zone) return null
    const ok = (x: number, z: number, margin: number) => zone(x, z) && this.clearOfObstacles(x, z, margin)
    return {
      spot: () => {
        for (let i = 0; i < 200; i++) {
          const x = (Math.random() * 2 - 1) * HX
          const z = CZ + (Math.random() * 2 - 1) * HZ
          if (ok(x, z, 0.45)) return new THREE.Vector3(x, 0, z)
        }
        return new THREE.Vector3(0, 0, 0)
      },
      clamp: (p) => {
        this.clampToRanch(p)
        if (zone(p.x, p.z)) return
        for (let r = 0.1; r <= 4; r += 0.1) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2
            const x = p.x + Math.cos(a) * r
            const z = p.z + Math.sin(a) * r
            if (!ok(x, z, 0)) continue
            p.x = x
            p.z = z
            return
          }
        }
      },
      route: (a, b) => {
        const steps = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / PATH_STEP))
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          if (!ok(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.24)) return null
        }
        return [b]
      },
    }
  }

  /** 依寵物住哪裡把點拉回去：水中的拉回水裡、陸地的推出水外、兩棲的只管柵欄與樹 */
  clampFor(p: THREE.Vector3, habitat: Habitat, margin: number): void {
    if (habitat === 'water') {
      this.lake.clampInto(p, margin)
      return
    }
    this.clampToRanch(p)
    // 站在棧橋上、或被擠到橋邊的不推出水外（會一路被推回沙灘）：橋邊的交給下面的 leaveNoGo 放回最近能站的地方
    if (habitat === 'land' && !this.onDeck(p.x, p.z) && !this.map.noGo?.(p.x, p.z)) this.lake.pushOut(p, 0.1)
    this.leaveNoGo(p, habitat)
  }

  /** 被擠進誰都不能去的地方（火山的山坡、山後面、棧橋的兩側）時，移到最近的一個這種寵物可以站的點 */
  private leaveNoGo(p: THREE.Vector3, habitat: Habitat): void {
    const noGo = this.map.noGo
    if (!noGo || !noGo(p.x, p.z)) return
    for (let r = 0.1; r <= 4; r += 0.1) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        const x = p.x + Math.cos(a) * r
        const z = p.z + Math.sin(a) * r
        if (!this.canStand(x, z, 0, habitat)) continue
        p.x = x
        p.z = z
        return
      }
    }
  }

  /** 把點拉回柵欄內、推出樹（被別隻擠出去、或走歪的時候） */
  clampToRanch(p: THREE.Vector3): void {
    // 拉回「往內縮 WALK_INSET 的圓角正方形」
    const hx = HX - WALK_INSET
    const hz = HZ - WALK_INSET
    const r = Math.max(RANCH.corner - WALK_INSET, 0.01)
    let z = THREE.MathUtils.clamp(p.z - CZ, -hz, hz)
    p.x = THREE.MathUtils.clamp(p.x, -hx, hx)
    const qx = Math.abs(p.x) - (hx - r)
    const qz = Math.abs(z) - (hz - r)
    if (qx > 0 && qz > 0) {
      const len = Math.hypot(qx, qz)
      if (len > r) {
        p.x = Math.sign(p.x) * (hx - r + (qx / len) * r)
        z = Math.sign(z) * (hz - r + (qz / len) * r)
      }
    }
    p.z = z + CZ
    for (const o of this.obstacles) {
      const dx = p.x - o.x
      const dz = p.z - o.z
      const dist = Math.hypot(dx, dz)
      const min = o.r + 0.45
      if (dist < min && dist > 1e-4) {
        p.x = o.x + (dx / dist) * min
        p.z = o.z + (dz / dist) * min
      }
    }
  }

  /** 從 a 走到 b 的直線有沒有穿過這種寵物不能去的地方 */
  pathClear(a: THREE.Vector3, b: THREE.Vector3, margin: number, habitat: Habitat = 'land'): boolean {
    const steps = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / PATH_STEP))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      if (!this.canStand(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, margin * 0.6, habitat)) return false
    }
    return true
  }

  /** 地面：一張高度網格（草地、沙灘、湖底）＋外圍一圈泥土側面＋水面（lake.ts） */
  private buildIsland(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(RANCH.w, RANCH.d, Math.round(RANCH.w * 22), Math.round(RANCH.d * 22))
    geo.rotateX(-Math.PI / 2)
    // 網格中心移到小島中心
    geo.translate(0, 0, CZ)
    const pos = geo.attributes.position
    const colors: number[] = []
    // 2026-11-12 使用者「草地綠有點太螢光」：0x6fb04a／0x7cbc52 → 調暗、降彩度
    const grass = new THREE.Color(0x5f9150)
    const grass2 = new THREE.Color(0x6b9d58)
    // 沙地（中央河上岸）：比沙灘深一點，帶淡淡的風紋
    const dune = new THREE.Color(0xdcc794)
    const dune2 = new THREE.Color(0xcfb782)
    const land = new THREE.Color()
    const sandOf = this.map.sand
    const petalsOf = this.map.petals
    const pathOf = this.map.path
    const packed = new THREE.Color(SNOW_GROUND.path)
    const petal = new THREE.Color(PETAL_GROUND)
    const sandDry = new THREE.Color(0xeadcae)
    const sandWet = new THREE.Color(0xd5c08a)
    const moss = new THREE.Color(0x7d9a6c)
    const deep = new THREE.Color(0x3f7480)
    // 雪地：草地 → 雪、沙灘 → 湖岸碎石、湖底 → 冰藍／深藍（snow.ts）
    if (this.map.theme === 'snow') {
      grass.setHex(SNOW_GROUND.snow)
      grass2.setHex(SNOW_GROUND.snow2)
      sandDry.setHex(SNOW_GROUND.shore)
      sandWet.setHex(SNOW_GROUND.shoreWet)
      moss.setHex(SNOW_GROUND.bedShallow)
      deep.setHex(SNOW_GROUND.bedDeep)
    }
    // 海灘：亮一點的草、淺色的沙、海底由透出沙色的青綠到深藍（beach.ts）
    const beach = this.map.theme === 'beach'
    if (beach) {
      grass.setHex(BEACH_GROUND.grass)
      grass2.setHex(BEACH_GROUND.grass2)
      dune.setHex(BEACH_GROUND.sand)
      dune2.setHex(BEACH_GROUND.sand2)
      sandDry.setHex(BEACH_GROUND.shore)
      sandWet.setHex(BEACH_GROUND.shoreWet)
      moss.setHex(BEACH_GROUND.bedShallow)
      deep.setHex(BEACH_GROUND.bedDeep)
    }
    const crater = this.map.theme === 'volcano' ? this.map.crater : undefined
    const moonBase = this.map.theme === 'moon' ? this.map.moonBase : undefined
    const foam = new THREE.Color(BEACH_GROUND.foam)
    // 地形（高低、顏色）用的水域：海是 map.seabed（一路到小島邊緣），其他地圖就是 map.water
    const terrain = this.map.seabed ?? this.map.water
    // 賞櫻：草地淡一點；水岸是灰白的碎石、池底偏青綠（sakura.ts）
    if (this.map.theme === 'sakura') {
      grass.setHex(SAKURA_GROUND.grass)
      grass2.setHex(SAKURA_GROUND.grass2)
      sandDry.setHex(SAKURA_GROUND.shore)
      sandWet.setHex(SAKURA_GROUND.shoreWet)
      moss.setHex(SAKURA_GROUND.bedShallow)
      deep.setHex(SAKURA_GROUND.bedDeep)
    }
    const c = new THREE.Color()
    const smooth = THREE.MathUtils.smoothstep
    const r = RANCH.corner
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i)
      let z = pos.getZ(i)
      // 圓角外面的頂點拉回圓角上
      const qx = Math.abs(x) - (HX - r)
      const qz = Math.abs(z - CZ) - (HZ - r)
      if (qx > 0 && qz > 0) {
        const len = Math.hypot(qx, qz)
        if (len > r) {
          x = Math.sign(x) * (HX - r + (qx / len) * r)
          z = CZ + Math.sign(z - CZ) * (HZ - r + (qz / len) * r)
        }
      }
      const d = terrain(x, z)
      const y = this.lake.bedY(x, z)
      pos.setXYZ(i, x, y, z)
      // 火山口湖：整片地面的顏色由 volcano.ts 決定（火山灰、山坡、岩石、硫磺的湖岸、湖底）
      if (crater) {
        volcanoGroundColor(crater, x, z, d, y, c)
        colors.push(c.r, c.g, c.b)
        continue
      }
      // 海底世界：整片地面的顏色由 undersea.ts 決定（罩子裡的草地、海床的沙）
      if (this.map.theme === 'undersea') {
        underseaGroundColor(x, z, d, c)
        colors.push(c.r, c.g, c.b)
        continue
      }
      // 月面基地：整片地面的顏色由 moon.ts 決定（月面、隕石坑、罩子裡的地板、池底）
      if (moonBase) {
        moonGroundColor(moonBase, x, z, d, y, c)
        colors.push(c.r, c.g, c.b)
        continue
      }
      // 顏色：草地（淡淡的深淺；沙地是沙色）→ 沙灘 → 濕沙 → 青苔 → 深水
      if (sandOf && sandOf(x, z) > 0.5) land.copy(dune).lerp(dune2, 0.5 + 0.5 * Math.sin(x * 2.1 + z * 0.9) * Math.sin(z * 1.3 - x * 0.4))
      else land.copy(grass).lerp(grass2, 0.5 + 0.5 * Math.sin(x * 1.3) * Math.sin(z * 1.7))
      // 賞櫻：櫻花樹底下淡淡帶一點粉紅（一片片的花瓣另外撒，sakura.ts 的 buildFallenPetals）
      if (petalsOf) land.lerp(petal, SAKURA_GROUND.basePetal + SAKURA_GROUND.petalTint * petalsOf(x, z))
      // 雪地：鏟過雪的小路，踩實的雪比旁邊暗一點（snow.ts）
      if (pathOf) land.lerp(packed, 0.85 * pathOf(x, z))
      if (d < -BEACH_WIDTH - 0.2) c.copy(land)
      else if (d < -BEACH_WIDTH) c.copy(land).lerp(sandDry, smooth(d, -BEACH_WIDTH - 0.2, -BEACH_WIDTH))
      else if (d < 0) c.copy(sandDry).lerp(sandWet, smooth(d, -0.3, 0))
      else if (d < 0.7) c.copy(sandWet).lerp(moss, d / 0.7)
      else c.copy(moss).lerp(deep, smooth(d, 0.7, beach ? 2.4 : 1.5))
      // 海灘：水岸線上一條白色的浪花，再往外兩道淡淡的浪（畫在海底，隔著水看是兩條亮線）
      if (beach && d > -0.22 && d < 0.14) c.lerp(foam, 0.85 * (1 - Math.abs(d + 0.04) / 0.18))
      if (beach && d > 0.3) {
        const wobble = d + 0.09 * Math.sin(z * 2.1 + x * 0.6)
        c.lerp(foam, 0.42 * Math.max(0, 1 - Math.abs(wobble - 0.62) / 0.07) + 0.26 * Math.max(0, 1 - Math.abs(wobble - 1.3) / 0.08))
      }
      colors.push(c.r, c.g, c.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
    this.world.add(ground)

    // 泥土側面：沿外框往下一圈，上緣稍微往外倒角
    const ring = outline(0, 360)
    const layers: [number, number][] = [
      [0, 0],
      [-0.08, 0.08],
      [-0.16, 0.12],
      [-0.78, 0.12],
      [-0.86, 0.04],
    ]
    const normals = ring.map((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length]
      const b = ring[(i + 1) % ring.length]
      const t = b.clone().sub(a).normalize()
      const n = new THREE.Vector2(t.y, -t.x)
      // 往外：跟「點相對小島中心」同方向
      if (n.dot(new THREE.Vector2(p.x, p.y - CZ)) < 0) n.negate()
      return n
    })
    // 海（map.seabed）到小島邊緣的地方：側面的頂端降到海底，上面那一截是海水（下面另外補一片斷面）
    const tops = ring.map((p) => (this.map.seabed ? Math.min(0, this.lake.bedY(p.x, p.y)) : 0))
    const wallPos: number[] = []
    for (const [y, out] of layers) {
      ring.forEach((p, i) => {
        const sunk = y > tops[i]
        const o = sunk ? 0 : out
        wallPos.push(p.x + normals[i].x * o, sunk ? tops[i] : y, p.y + normals[i].y * o)
      })
    }
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
    this.world.add(new THREE.Mesh(wall, new THREE.MeshStandardMaterial({ color: beach ? BEACH_GROUND.cliff : crater ? VOLCANO_GROUND.cliff : moonBase ? MOON_GROUND.cliff : this.map.theme === 'undersea' ? UNDERSEA_GROUND.cliff : 0x9a6b43, roughness: 1, side: THREE.DoubleSide })))
    if (this.map.seabed) this.buildSeaCut(ring, tops)
    return ground
  }

  /**
   * 海水的斷面（左側海）：沿著小島外緣、海到邊緣的那幾段，從水面到海底補一片半透明的藍。
   * 從側面看就像切開的模型，看得到一截海水；不補的話水面底下是空的，會直接看到沒有蓋水的海底
   */
  private buildSeaCut(ring: THREE.Vector2[], tops: number[]): void {
    const pos: number[] = []
    const idx: number[] = []
    const n = ring.length
    ring.forEach((p, i) => pos.push(p.x, WATER_Y, p.y, p.x, Math.min(tops[i], WATER_Y), p.y))
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      if (tops[i] > WATER_Y - 0.01 && tops[j] > WATER_Y - 0.01) continue
      idx.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1)
    }
    if (idx.length === 0) return
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const cut = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: BEACH_WATER, transparent: true, opacity: 0.72, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    )
    cut.renderOrder = 1
    this.world.add(cut)
  }

  /** 是不是沙地（不長草、花） */
  private isSand(x: number, z: number): boolean {
    return (this.map.sand?.(x, z) ?? 0) > 0.5
  }

  /** 草叢：一撮撮小三角錐，讓草地不要太平（水裡、沙灘、沙地上不長） */
  private buildTufts(): void {
    const tuft = new THREE.ConeGeometry(0.05, 0.16, 4)
    const tuftColor = this.map.theme === 'sakura' ? SAKURA_GROUND.tuft : this.map.theme === 'beach' ? BEACH_GROUND.tuft : 0x527f42
    const tuftMat = new THREE.MeshStandardMaterial({ color: tuftColor, roughness: 1, flatShading: true })
    // 賞櫻的草叢少一點：地上已經有落花、飛石、油菜花，再撒滿草叢會太雜
    // 海灘的草地只佔一半、顏色也亮：草叢少一點、淡一點
    const tufts = new THREE.InstancedMesh(tuft, tuftMat, this.map.theme === 'sakura' ? 320 : this.map.theme === 'beach' ? 480 : this.map.theme === 'undersea' ? 260 : 900)
    const m = new THREE.Matrix4()
    for (let i = 0; i < tufts.count; i++) {
      let placed = false
      for (let k = 0; k < 20 && !placed; k++) {
        const x = (Math.random() * 2 - 1) * HX
        const z = CZ + (Math.random() * 2 - 1) * HZ
        if (edgeDist(x, z) < 0.25 || !this.lake.isLand(x, z) || this.isSand(x, z)) continue
        m.makeTranslation(x, 0.07, z)
        placed = true
      }
      if (!placed) m.makeTranslation(0, -5, 0)
      tufts.setMatrixAt(i, m)
    }
    this.world.add(tufts)
  }

  /** 沙地上零星的小石頭（很小，不擋路） */
  private buildPebbles(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb3a994, roughness: 1, flatShading: true })
    for (let i = 0, placed = 0; i < 400 && placed < 16; i++) {
      const x = (Math.random() * 2 - 1) * HX
      const z = CZ + (Math.random() * 2 - 1) * HZ
      if (edgeDist(x, z) < 0.6 || !this.lake.isLand(x, z) || !this.isSand(x, z) || this.deckY(x, z) !== null) continue
      const r = 0.05 + Math.random() * 0.09
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat)
      rock.position.set(x, r * 0.25, z)
      rock.rotation.set(Math.random() * 3, Math.random() * 3, 0)
      rock.scale.y = 0.55
      this.world.add(rock)
      placed++
    }
  }

  private buildFence(): void {
    // 月面基地：寵物被玻璃罩關著，整圈不圍柵欄、也不蓋木門
    if (this.map.noFence) return
    const sakura = this.map.theme === 'sakura'
    const snowy = this.map.theme === 'snow'
    const volcanic = this.map.theme === 'volcano'
    const wood = new THREE.MeshStandardMaterial({ color: sakura ? SAKURA_WOOD.fence : snowy ? SNOW_WOOD.fence : volcanic ? VOLCANO_WOOD.fence : 0xc89a63, roughness: 0.9 })
    const pts = outline(FENCE_INSET, Math.round((2 * (RANCH.w + RANCH.d)) / 0.36))
    // 留一個缺口當入口（正前方，或 map.gateSide 指定的右邊），柵欄才不會整排擋在寵物前面；靠水的那一段不圍（水直接到沙灘；賞櫻例外，map.fenceWater 整圈都圍）
    const right = this.map.gateSide === 'right'
    const inGate = (p: THREE.Vector2) => (right ? p.x > 0 && Math.abs(p.y - CZ) < GATE_HALF : p.y > 0 && Math.abs(p.x) < GATE_HALF)
    const keep = pts.map((p) => !inGate(p) && (this.map.fenceWater || this.map.water(p.x, p.y) < -0.9))
    const postGeo = new THREE.BoxGeometry(0.1, 0.42, 0.1)
    pts.forEach((p, i) => {
      if (!keep[i]) return
      const post = new THREE.Mesh(postGeo, wood)
      post.position.set(p.x, 0.21, p.y)
      this.world.add(post)
      if (this.map.theme === 'snow') this.world.add(snowCap(post, 0.42))
      const j = (i + 1) % pts.length
      if (!keep[j]) return
      const q = pts[j]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      for (const y of [0.16, 0.32]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.04), wood)
        rail.position.set((p.x + q.x) / 2, y, (p.y + q.y) / 2)
        rail.rotation.y = -Math.atan2(q.y - p.y, q.x - p.x)
        this.world.add(rail)
      }
    })
    this.buildGate(wood)
  }

  /**
   * 入口的木門（2026-11-12 使用者）：柵欄正前方的缺口（等角畫面上在左下邊的中間）；左側海開在右邊（map.gateSide，畫面右下邊的中間）。
   * 兩根比柵欄高的門柱，中間兩扇木板門，關著（2026-11-12 使用者：門柱上面的橫樑拿掉、門都改成關著）。只是裝飾，寵物本來就走不到柵欄邊。
   */
  private buildGate(wood: THREE.Material): void {
    const theme = this.map.theme
    const dark = new THREE.MeshStandardMaterial({ color: theme === 'sakura' ? SAKURA_WOOD.gate : theme === 'snow' ? SNOW_WOOD.gate : theme === 'volcano' ? VOLCANO_WOOD.gate : 0x9c6c3c, roughness: 0.9 })
    // 木門那一段沒有柵欄（靠水、整圈都不圍，例如中央島）就不蓋木門，不然會是一扇孤零零立在水邊的門
    const gx = this.map.gateSide === 'right' ? HX - FENCE_INSET : 0
    const gz = this.map.gateSide === 'right' ? CZ : RANCH.front - FENCE_INSET
    if (!this.map.fenceWater && this.map.water(gx, gz) >= -0.9) return
    const gate = new THREE.Group()
    if (this.map.gateSide === 'right') {
      // 右邊（+x 那條邊）的中間：整組轉 90°，門的外側（local +z）朝 +x
      gate.position.set(HX - FENCE_INSET, 0, CZ)
      gate.rotation.y = Math.PI / 2
    } else {
      gate.position.set(0, 0, RANCH.front - FENCE_INSET)
    }
    // 門柱（頂上一塊柱帽）
    const postGeo = new THREE.BoxGeometry(0.15, 0.72, 0.15)
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, dark)
      post.position.set(sx * GATE_HALF, 0.36, 0)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), dark)
      cap.position.set(sx * GATE_HALF, 0.745, 0)
      gate.add(post, cap)
    }
    // 兩扇門：門軸在門柱內側，關著（兩扇在中間接起來）
    const leafW = GATE_HALF - 0.1
    for (const sx of [-1, 1]) {
      const hinge = new THREE.Group()
      hinge.position.set(sx * (GATE_HALF - 0.08), 0, 0)
      // 門板朝中間（-sx 方向）。要打開的話繞 y 轉 sx×角度（正的往外、+z）
      hinge.rotation.y = GATE_OPEN * sx
      const leaf = new THREE.Group()
      // 直的木板
      for (let k = 0; k < 4; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(leafW / 4 - 0.025, 0.4, 0.035), wood)
        plank.position.set(-sx * (leafW / 8 + (k * leafW) / 4), 0.26, 0)
        leaf.add(plank)
      }
      // 上下兩根橫檔＋一根斜撐
      for (const y of [0.13, 0.39]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(leafW, 0.05, 0.03), dark)
        bar.position.set((-sx * leafW) / 2, y, 0.03)
        leaf.add(bar)
      }
      const brace = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(leafW, 0.26), 0.045, 0.03), dark)
      brace.position.set((-sx * leafW) / 2, 0.26, 0.03)
      brace.rotation.z = sx * Math.atan2(0.26, leafW)
      leaf.add(brace)
      hinge.add(leaf)
      gate.add(hinge)
    }
    this.world.add(gate)
  }

  private buildTree(x: number, z: number, size: number): void {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09 * size, 0.13 * size, 0.9 * size, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 }),
    )
    trunk.position.set(x, 0.45 * size, z)
    this.world.add(trunk)
    const leaves = new THREE.MeshStandardMaterial({ color: 0x4a8a3c, roughness: 0.9, flatShading: true })
    for (const [dx, dy, dz, r] of [
      [0, 1.15, 0, 0.55],
      [-0.28, 0.95, 0.12, 0.38],
      [0.3, 1.0, -0.05, 0.4],
    ]) {
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r * size, 1), leaves)
      ball.position.set(x + dx * size, dy * size, z + dz * size)
      this.world.add(ball)
    }
    this.obstacles.push({ x, z, r: 0.35 * size })
  }

  private buildFlowers(): void {
    // 賞櫻：只留白、淡粉、淡黃，數量也少一點（主角是櫻花）
    const sakura = this.map.theme === 'sakura'
    const palette = sakura ? SAKURA_FLOWERS : [0xff8fb1, 0xffe066, 0xffffff, 0xc49bff, 0xff9a5c]
    const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4)
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d8a34 })
    const head = new THREE.SphereGeometry(0.05, 8, 6)
    for (let i = 0; i < (sakura ? 55 : 110); i++) {
      let p = this.randomSpot(0.1)
      for (let k = 0; k < 8 && this.isSand(p.x, p.z); k++) p = this.randomSpot(0.1)
      if (this.isSand(p.x, p.z)) continue
      const s = new THREE.Mesh(stem, stemMat)
      s.position.set(p.x, 0.07, p.z)
      const h = new THREE.Mesh(head, new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.6 }))
      h.position.set(p.x, 0.15, p.z)
      this.world.add(s, h)
    }
  }
}
