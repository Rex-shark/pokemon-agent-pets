/**
 * 牧場上的一隻寶可夢：載模型、播動作、自己在牧場裡亂逛。
 *
 * 平常（自由活動）：待機幾秒 → 挑個地方走過去（偶爾用跑的）→ 待機……偶爾原地開心一下。
 * agent 的狀態會蓋過去：
 * - 睡著（太久沒有 hook、模型有 sleep 動作）：停下來播 sleep，不再亂逛
 * - waiting（等你確認）：停下來轉向鏡頭，等你處理
 * - 提醒：做完 → 播一次 happy；出錯 → 播一次 attack
 * agent 在忙（busy）時照樣亂逛，只是頭上有泡泡（bubbles.ts）。
 *
 * 水（2026-11-11 原型，habitat.ts）：水中的只在湖裡游、兩棲的偶爾下水。在水裡時身體沉下去（湖底比游泳深度淺就站在湖底＝涉水），
 * 上下漂、輕輕搖，周圍一直有水波；入水、出水時噴水花。會飛的在水裡不浮空。
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import type { SizeClass, SpeciesInfo } from '../shared/ranch-protocol'
import { habitatOf, swimSink, type Habitat } from './habitat'
import type { RanchScene, Terrain } from './ranch-scene'

/**
 * 各尺寸級距在牧場上的高度與最大佔地（世界單位）。級距由 shared/size-classes.json 決定（2026-11-11 使用者：
 * S／M／L 照待機高度 30%／40%／30%，大岩蛇、卡比獸、暴鯉龍手動指定 LL）。
 * 佔地：太寬、太長的（暴鯉龍、大岩蛇）再縮小，免得擋住整個牧場。
 */
const SIZES: Record<SizeClass, { height: number; footprint: number }> = {
  S: { height: 0.85, footprint: 1.3 },
  M: { height: 1.2, footprint: 1.8 },
  L: { height: 1.55, footprint: 2.3 },
  LL: { height: 2.1, footprint: 4.5 },
}
const WALK_SPEED = 0.55
const RUN_SPEED = 1.5
const TURN_SPEED = 6
/** 打輸的逃跑速度（比平常跑更快） */
const FLEE_SPEED = RUN_SPEED * 1.3
/**
 * 打架時攻擊動作的播放速度（2026-11-12 使用者「戰鬥時攻擊速度能加快？」：1 → 1.7）。
 * 只有打架用；出錯時播的攻擊動作維持原速
 */
const FIGHT_ATTACK_SPEED = 1.7
/** 每一招最長等多久（有的攻擊動作 5 秒以上，連打三次會很拖，時間到就直接出下一招）；跟著加速從 2800 縮短 */
const ROUND_MAX_MS = 1700
/** 兩招之間喘一下（毫秒，隨機）；跟著加速從 150～400 縮短 */
const ROUND_GAP_MS = { min: 80, max: 220 }
/** 會飛的寶可夢最多離地多高（身高的比例） */
const MAX_HOVER = 0.3
const FADE = 0.3
/** 在水裡游得比走路慢一點 */
const SWIM_SPEED_RATIO = 0.75
/** 兩棲的在陸上時挑目的地，有多少機率去游泳；在水裡時多少機率上岸 */
const AMPHIBIOUS_GO_SWIM = 0.3
const AMPHIBIOUS_GO_ASHORE = 0.55
/** 漂浮：上下幅度（世界單位，大隻的再乘身高）、頻率 */
const BOB_AMP = 0.035
const BOB_HZ = 0.55
/** 挑目的地時最遠走多遠（太遠的話一趟要走很久） */
const MAX_WANDER = 6.3
/** 挑陸地上的目的地時，有這個機率改挑棧橋上的點（地圖有棧橋才有用；2026-11-13 左側海的木棧橋） */
const PIER_VISIT = 0.12

type Activity = 'idle' | 'walk' | 'run' | 'oneshot' | 'sleep' | 'attention' | 'fight'

const loader = new GLTFLoader()
/** 同一種寶可夢只下載、解析一次，之後用 SkeletonUtils.clone 複製 */
const gltfCache = new Map<string, Promise<GLTF>>()

function loadSpecies(species: SpeciesInfo): Promise<GLTF> {
  let p = gltfCache.get(species.id)
  if (!p) {
    p = loader.loadAsync(species.modelUrl)
    gltfCache.set(species.id, p)
    p.catch(() => gltfCache.delete(species.id))
  }
  return p
}

/** 腳底的圓形陰影（比 shadow map 便宜，而且透明視窗上看起來比較乾淨） */
let shadowTexture: THREE.Texture | null = null
function blobShadow(): THREE.Mesh {
  if (!shadowTexture) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,0.38)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    shadowTexture = new THREE.CanvasTexture(c)
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.015
  mesh.renderOrder = -1
  return mesh
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** 兩個角度的最短差（-π ~ π） */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** NPC 的活動範圍（RanchScene.npcRoam 給的）：挑目的地、被擠出去時拉回來、檢查直線走不走得到 */
export interface Roam {
  spot(): THREE.Vector3
  clamp(p: THREE.Vector3): void
  route(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] | null
}

export class PetActor {
  readonly sessionId: string
  readonly species: SpeciesInfo
  /** 放在場景裡的根節點：位置＝腳底，rotation.y＝面向 */
  readonly root = new THREE.Group()
  /** 滑鼠判斷用的隱形方塊（對蒙皮網格做 raycast 太貴） */
  readonly hitBox: THREE.Mesh
  private readonly shadow = blobShadow()
  /** 縮放後的高度（泡泡放在頭頂上方） */
  height = SIZES.M.height
  /** 身體半徑（佔地的一半）：跟別隻保持距離、判斷撞上用 */
  radius = 0.35
  /** 身長（寬、深取大的） */
  length = 0.7
  loaded = false

  /** 縮放＋上下挪（groundOffset）用的節點 */
  private readonly holder = new THREE.Group()
  /** 各動作要上下挪多少，才不會飛太高或陷進地裡 */
  private readonly groundOffset = new Map<THREE.AnimationAction, number>()
  /** 各動作挪完之後離地多高（0 ~ MAX_HOVER 個身高）；泡泡要跟著抬高 */
  private readonly hoverHeight = new Map<THREE.AnimationAction, number>()
  /** 目前離地多高（慢慢跟上） */
  hover = 0
  private mixer: THREE.AnimationMixer | null = null
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private activity: Activity = 'idle'
  private timer = rand(0.5, 3)
  private target: THREE.Vector3 | null = null
  /** 走到 target 之後接著要去的點（上下棧橋要先繞到橋頭，ranch-scene.ts 的 route）；每次挑新目的地都會重設 */
  private route: THREE.Vector3[] = []
  private speed = WALK_SPEED
  private facing = rand(-Math.PI, Math.PI)
  private asleep = false
  private waiting = false
  /** 打輸正在逃跑（頭上冒汗；跑到目的地或被打斷就結束） */
  private fleeing = false
  /** 正在打架的對手（activity === 'fight' 時才有） */
  private opponent: PetActor | null = null
  private readonly ranch: RanchScene
  /** NPC 的活動範圍；一般的寵物是 null */
  private readonly roam: Roam | null
  /** 住哪裡：陸地、水陸兩棲、水中 */
  readonly habitat: Habitat
  /** 在水裡的程度（0 陸上 ～ 1 泡在水裡，慢慢跟上）：浮空、泡泡高度、陰影跟著它 */
  private wet = 0
  /** 腳底（沒有漂浮的部分）的高度，慢慢跟上湖底或游泳深度 */
  private baseY = 0
  /** 腳泡到水了（入水、出水噴水花用） */
  private inWaterNow = false
  private rippleTimer = rand(0, 1)
  /** 海底世界：水系離海床多高（現在、要去的、多久換一次）；-1 是還沒挑 */
  private seaAlt = -1
  private seaAltTarget = 0
  private seaAltTimer = 0
  /** 影子平常的大小（海底世界浮得越高影子越大，從這個放大） */
  private shadowSize = 0.9
  private readonly bobPhase = rand(0, Math.PI * 2)
  private clock = 0

  /**
   * roam：不照牧場的規則活動，改在指定的範圍裡挑目的地（NPC 用，例如月面基地罩外的皮皮；npcs.ts）。
   * 有給的話一律當陸地的寵物，at 是出場位置
   */
  constructor(sessionId: string, species: SpeciesInfo, ranch: RanchScene, roam?: Roam, at?: [number, number]) {
    this.sessionId = sessionId
    this.species = species
    this.ranch = ranch
    this.roam = roam ?? null
    // 海底世界：兩棲的也算水系，放到罩外的海裡（2026-11-17 使用者「水陸兩用的也判斷丟到水中」）
    const habitat = habitatOf(species.id)
    this.habitat = roam ? 'land' : ranch.seaFloat && habitat === 'amphibious' ? 'water' : habitat
    this.root.position.copy(roam ? (at ? new THREE.Vector3(at[0], 0, at[1]) : roam.spot()) : ranch.randomSpot(0.5, this.habitat === 'water' ? 'water' : 'land'))
    this.root.rotation.y = this.facing
    this.hitBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }))
    this.hitBox.userData.sessionId = sessionId
    this.root.add(this.hitBox)
    this.shadow.scale.setScalar(0.9)
    this.root.add(this.shadow)
  }

  async load(): Promise<void> {
    const gltf = await loadSpecies(this.species)
    const model = cloneSkinned(gltf.scene)
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false
    })

    // 量待機姿勢的大小，縮成統一高度、腳底貼地、置中
    this.mixer = new THREE.AnimationMixer(model)
    for (const clip of gltf.animations) {
      const name = clip.name.toLowerCase()
      const key = ['idle', 'walk', 'run', 'attack', 'happy', 'sleep'].find((k) => name === k || name.includes(k))
      if (key && !this.actions.has(key)) this.actions.set(key, this.mixer.clipAction(clip))
    }
    const idle = this.actions.get('idle') ?? null
    // 全部先量完再擺進場景（量的是模型自己的座標；擺進去之後 setFromObject 會變成世界座標）
    const box = this.measure(model, idle)
    // 每個動作腳底離地多高不一樣（會飛的寶可夢走路、睡覺時會飛到半空中，有的動作會陷進地裡）
    const rawLift = new Map<THREE.AnimationAction, number>()
    for (const action of this.actions.values()) rawLift.set(action, this.measure(model, action).min.y - box.min.y)

    const size = box.getSize(new THREE.Vector3())
    const target = SIZES[this.species.sizeClass] ?? SIZES.M
    let scale = target.height / Math.max(size.y, 1e-3)
    const footprint = Math.max(size.x, size.z) * scale
    if (footprint > target.footprint) scale *= target.footprint / footprint
    const center = box.getCenter(new THREE.Vector3())
    this.holder.scale.setScalar(scale)
    model.position.set(-center.x, -box.min.y, -center.z)
    this.holder.add(model)
    this.root.add(this.holder)

    // 播那個動作時把整隻上下挪：最多只浮 MAX_HOVER 個身高，陷進地裡的抬回地面
    const maxHover = MAX_HOVER * size.y * scale
    for (const [action, raw] of rawLift) {
      const lift = raw * scale
      const hover = Math.min(Math.max(lift, 0), maxHover)
      this.groundOffset.set(action, hover - lift)
      this.hoverHeight.set(action, hover)
    }
    this.mixer.stopAllAction()
    idle?.play()
    this.holder.position.y = idle ? (this.groundOffset.get(idle) ?? 0) : 0

    this.height = size.y * scale
    const w = Math.max(size.x, size.z) * scale
    this.hitBox.scale.set(Math.max(w * 0.8, 0.4), this.height, Math.max(w * 0.8, 0.4))
    this.hitBox.position.y = this.height / 2
    this.shadowSize = Math.max(w * 0.95, 0.5)
    this.shadow.scale.setScalar(this.shadowSize)
    // 長條形的（暴鯉龍）用寬、深的平均，不然半徑大到別隻都靠不近
    this.radius = Math.max(((size.x + size.z) / 2) * scale * 0.5, 0.3)
    this.length = w

    this.current = this.actions.get('idle') ?? null
    // 一出場就在對的高度（水中的直接泡在水裡，不噴水花）
    this.clampHome(this.root.position)
    this.baseY = this.restY()
    this.root.position.y = this.baseY
    this.inWaterNow = this.baseY < this.waterSurface() - 0.04
    this.wet = this.inWaterNow ? 1 : 0
    this.loaded = true
    // 模型還沒載完時就可能已經被設成睡著／等你（重開 App 時存檔裡的寵物），那時沒有動作可播，現在補播
    if (this.asleep) this.play('sleep')
  }

  /** 擺出某個動作第一格的姿勢量外框（不擺就是綁定姿勢） */
  private measure(model: THREE.Object3D, action: THREE.AnimationAction | null): THREE.Box3 {
    this.mixer?.stopAllAction()
    action?.reset().play()
    this.mixer?.update(0)
    model.updateMatrixWorld(true)
    // 蒙皮的骨骼矩陣平常在 render 時才更新；不先更新的話量到的是綁定姿勢
    model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.update()
    })
    return new THREE.Box3().setFromObject(model, true)
  }

  get canSleep(): boolean {
    return this.actions.has('sleep')
  }

  /** 由 main.ts 每秒判斷：太久沒 hook 且模型有 sleep 動作 */
  setAsleep(asleep: boolean): void {
    if (asleep === this.asleep) return
    this.asleep = asleep
    if (asleep) {
      this.target = null
      this.activity = 'sleep'
      this.play('sleep')
    } else {
      // 醒來：伸個懶腰（開心一下）再開始逛
      this.oneShot('happy')
    }
  }

  /** agent 在等你：停下來面向鏡頭 */
  setWaiting(waiting: boolean): void {
    if (waiting === this.waiting) return
    this.waiting = waiting
    if (waiting) {
      this.target = null
      this.activity = 'attention'
      this.play('idle')
    } else if (this.activity === 'attention') {
      this.toIdle()
    }
  }

  get isAsleep(): boolean {
    return this.asleep
  }

  /** 提醒動作：做完、出錯、被點到 */
  react(kind: 'done' | 'error' | 'poke' | 'arrive'): void {
    if (this.asleep && kind !== 'error') return
    this.oneShot(kind === 'error' ? 'attack' : 'happy')
  }

  /** 可以被捲進打架嗎：醒著、沒在等你、正在逛（待機、走、跑），沒在做別的動作 */
  get canFight(): boolean {
    return this.loaded && !this.asleep && !this.waiting && (this.activity === 'idle' || this.activity === 'walk' || this.activity === 'run')
  }

  /** 在水裡（打架只跟同樣在水裡、或同樣在陸上的打） */
  get inWater(): boolean {
    return this.inWaterNow
  }

  /** 離岸要多遠：水中的用身體半徑的八成（長條的暴鯉龍尾巴還是會掃到沙灘），兩棲的只要一點點 */
  private get waterMargin(): number {
    // 長條的（暴鯉龍身長約 4.4）再看身長，頭才不會伸出柵欄
    // 窄的河放不下：最多到水域最深處再退一點（不然找不到夠深的地方，會卡住不動）
    if (this.habitat !== 'water') return 0.3
    return Math.min(Math.max(this.radius * 0.8, this.length * 0.38, 0.3), Math.max(this.ranch.lake.maxDist - 0.25, 0.3))
  }

  /** 腳底該在的高度：陸上是地面；在水裡沉到游泳深度，水底比較淺就站在水底 */
  private restY(): number {
    const { x, z } = this.root.position
    // 棧橋上：站在橋面（底下是海；左側海，ranch-scene.ts 的 deckY）
    const deck = this.habitat === 'water' ? null : this.ranch.deckY(x, z)
    if (deck !== null) return deck
    const bed = this.ranch.lake.bedY(x, z)
    if (this.habitat === 'land') return bed
    return Math.max(bed, this.waterSurface() - swimSink(this.species.id, this.habitat) * this.height)
  }

  /** 腳下這一點的水面高度（火山口湖的湖在山頂，水面比其他地圖高；lake.ts 的 surfaceY） */
  private waterSurface(): number {
    return this.ranch.lake.surfaceY(this.root.position.x, this.root.position.z)
  }

  /** 這隻要去哪種地方挑目的地 */
  private nextTerrain(): Terrain {
    if (this.habitat === 'water') return 'water'
    if (this.habitat === 'land') return 'land'
    return this.inWaterNow ? (Math.random() < AMPHIBIOUS_GO_ASHORE ? 'land' : 'water') : Math.random() < AMPHIBIOUS_GO_SWIM ? 'water' : 'land'
  }

  /** 把點拉回這隻能待的地方（NPC 用自己的範圍，其他照牧場的規則） */
  private clampHome(p: THREE.Vector3): void {
    if (this.roam) this.roam.clamp(p)
    else this.ranch.clampFor(p, this.habitat, this.waterMargin)
  }

  /** 從 a 到 b 要依序走過哪些點；走不到回 null */
  private routeTo(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] | null {
    return this.roam ? this.roam.route(a, b) : this.ranch.route(a, b, 0.4, this.habitat)
  }

  private spotFor(terrain: Terrain): THREE.Vector3 {
    if (this.roam) return this.roam.spot()
    // 兩棲的去游泳時往深一點的地方，才游得起來（不然只在淺灘涉水）
    // 水中的也往深處挑（離岸多 0.35），才浮得起來、不會老是趴在淺灘
    const margin = terrain === 'water' ? (this.habitat === 'water' ? this.waterMargin + 0.35 : 0.5 + this.radius * 0.5) : 0.45
    // 有棧橋的地圖（左側海）：偶爾挑橋上的點。橋面很小，照面積隨機挑幾乎不會有誰走上去
    if (terrain === 'land' && Math.random() < PIER_VISIT) {
      const spot = this.ranch.pierSpot()
      if (spot) return spot
    }
    return this.ranch.randomSpot(margin, terrain)
  }

  /** 頭上要顯示的特效：打架中（生氣＋冒煙）、打輸逃跑中（汗滴） */
  get mood(): 'fight' | 'flee' | null {
    if (this.activity === 'fight') return 'fight'
    return this.fleeing ? 'flee' : null
  }

  get isMoving(): boolean {
    return this.activity === 'walk' || this.activity === 'run'
  }

  /** 面向的方向（xz 平面的單位向量）：模型正面朝 +z，rotation.y 轉過去 */
  get forward(): THREE.Vector2 {
    const a = this.root.rotation.y
    return new THREE.Vector2(Math.sin(a), Math.cos(a))
  }

  /**
   * 開打：停下來、轉向對手，連續攻擊 rounds 次（2026-11-11 使用者：隨機 2～3 次，由 fights.ts 決定、兩隻一樣）。
   * 每次攻擊播完（或 ROUND_MAX_MS 到了，攻擊動作太長的就提早出下一招）接著下一次；全部打完 resolve(true)。
   * 中途被別的事打斷（睡著、等你確認、做完提醒…）resolve(false)。
   */
  startFight(opponent: PetActor, rounds: number): Promise<boolean> {
    this.target = null
    this.opponent = opponent
    this.activity = 'fight'
    const fighting = () => this.activity === 'fight' && this.opponent === opponent
    return new Promise((resolve) => {
      let settled = false
      let round = 0
      let roundTimer: ReturnType<typeof setTimeout> | undefined
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(roundTimer)
        const ok = fighting()
        // 打完先回待機姿勢等對方，但還是「打架中」（面向對手、不亂逛）
        if (ok) this.play('idle')
        resolve(ok)
      }
      const attack = () => {
        if (settled) return
        if (!fighting() || round >= rounds) return settle()
        const mine = ++round
        const next = () => {
          if (mine !== round) return // 這一招已經被計時器提早結束了
          clearTimeout(roundTimer)
          // 兩招之間喘一下
          setTimeout(attack, rand(ROUND_GAP_MS.min, ROUND_GAP_MS.max))
        }
        clearTimeout(roundTimer)
        roundTimer = setTimeout(next, ROUND_MAX_MS)
        this.oneShot('attack', next, 'fight', FIGHT_ATTACK_SPEED)
      }
      // 第一招稍微錯開，兩隻不會像鏡子一樣同時出手
      setTimeout(attack, rand(0, 350))
    })
  }

  /** 打贏：開心一下，然後照常逛 */
  winFight(): void {
    if (this.activity !== 'fight') return
    this.opponent = null
    this.oneShot('happy')
  }

  /** 打輸：往離贏家最遠的地方跑走 */
  loseFight(winnerAt: THREE.Vector3): void {
    if (this.activity !== 'fight') return
    this.opponent = null
    let best: THREE.Vector3[] | null = null
    let bestScore = -Infinity
    // 逃跑留在原本的地方（水裡的往湖的另一頭游、陸上的往草地另一頭跑）
    const terrain: Terrain = this.habitat === 'water' || (this.habitat === 'amphibious' && this.inWaterNow) ? 'water' : 'land'
    for (let i = 0; i < 16; i++) {
      const spot = this.spotFor(terrain)
      const path = this.routeTo(this.root.position, spot)
      if (!path) continue
      const score = spot.distanceTo(winnerAt)
      if (score > bestScore) {
        bestScore = score
        best = path
      }
    }
    if (!best) return this.toIdle()
    this.target = best[0]
    this.route = best.slice(1)
    this.speed = FLEE_SPEED
    this.fleeing = true
    this.activity = 'run'
    this.timer = 12
    this.play(this.actions.has('run') ? 'run' : 'walk')
  }

  /** 打架被打斷（對方被叫走了）：回去照常逛 */
  endFight(): void {
    if (this.activity !== 'fight') return
    this.opponent = null
    this.toIdle()
  }

  update(dt: number, others: PetActor[]): void {
    if (!this.loaded) return
    this.mixer?.update(dt)
    this.clock += dt
    // 逃跑結束（跑到了、被睡覺或等你確認打斷）就不再冒汗
    if (this.fleeing && this.activity !== 'run') this.fleeing = false
    // 換動作時上下挪的量慢慢跟上（跟動作的淡入淡出差不多快）；在水裡的不浮空（會飛的也泡在水裡）
    const hoverRaw = this.current ? (this.hoverHeight.get(this.current) ?? 0) : 0
    const offset = (this.current ? (this.groundOffset.get(this.current) ?? 0) : 0) - hoverRaw * this.wet
    const follow = Math.min(1, dt * 5)
    this.holder.position.y += (offset - this.holder.position.y) * follow
    const hover = hoverRaw * (1 - this.wet)
    this.hover += (hover - this.hover) * follow
    const pos = this.root.position

    switch (this.activity) {
      case 'idle':
        this.timer -= dt
        if (this.timer <= 0) this.decideNext()
        break
      case 'walk':
      case 'run': {
        this.timer -= dt
        const t = this.target!
        const dx = t.x - pos.x
        const dz = t.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.06 && this.route.length > 0) {
          // 到中途的點了（棧橋的橋頭），接著往下一個點走
          this.target = this.route.shift()!
          this.timer = Math.max(this.timer, 14)
          break
        }
        if (dist < 0.06 || this.timer <= 0) {
          this.toIdle()
          break
        }
        this.facing = Math.atan2(dx, dz)
        // 轉得差不多才開始走，避免原地側滑
        const turn = Math.abs(angleDelta(this.root.rotation.y, this.facing))
        const swim = this.inWaterNow ? SWIM_SPEED_RATIO : 1
        const step = Math.min(dist, this.speed * swim * dt * (turn > 1 ? 0.2 : 1))
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
        break
      }
      case 'attention': {
        // 面向鏡頭（等角鏡頭在右前方）
        const cam = this.ranch.camera.position
        this.facing = Math.atan2(cam.x - pos.x, cam.z - pos.z)
        break
      }
      case 'fight': {
        const o = this.opponent?.root.position
        if (o) this.facing = Math.atan2(o.x - pos.x, o.z - pos.z)
        break
      }
      case 'oneshot':
      case 'sleep':
        break
    }

    // 跟別隻保持一點距離（睡著的不動，別隻會繞開）
    if (!this.asleep) {
      for (const o of others) {
        if (o === this) continue
        const dx = pos.x - o.root.position.x
        const dz = pos.z - o.root.position.z
        const d = Math.hypot(dx, dz)
        // 兩隻的身體半徑加起來，大隻的彼此離遠一點
        const min = Math.max(this.radius + o.radius, 0.7)
        if (d < min && d > 1e-4) {
          const push = (min - d) * Math.min(1, dt * 4)
          pos.x += (dx / d) * push
          pos.z += (dz / d) * push
        }
      }
      this.clampHome(pos)
    }

    this.root.rotation.y += angleDelta(this.root.rotation.y, this.facing) * Math.min(1, dt * TURN_SPEED)
    this.updateWater(dt)
  }

  /** 沉下去、上下漂、水波、水花 */
  private updateWater(dt: number): void {
    const seaFloat = this.ranch.seaFloat
    if (seaFloat && this.habitat === 'water') {
      this.updateUndersea(dt, seaFloat)
      return
    }
    const pos = this.root.position
    if (this.habitat === 'land') {
      // 陸地的寵物腳底跟著地面：平常都是 0，只有走上棧橋的斜坡與橋面時會變高
      this.baseY += (this.restY() - this.baseY) * Math.min(1, dt * 10)
      pos.y = this.baseY
      return
    }
    const rest = this.restY()
    // 走下湖時慢慢沉下去（入水的過渡），上岸時慢慢浮上來
    this.baseY += (rest - this.baseY) * Math.min(1, dt * 3)
    const inWater = this.baseY < this.waterSurface() - 0.04
    const floating = rest > this.ranch.lake.bedY(pos.x, pos.z) + 0.01
    this.wet += ((inWater ? 1 : 0) - this.wet) * Math.min(1, dt * 3)
    // 漂浮（腳碰不到底）時上下漂、左右輕輕搖
    const t = this.clock * BOB_HZ * Math.PI * 2 + this.bobPhase
    const float = floating ? this.wet : 0
    pos.y = this.baseY + Math.sin(t) * BOB_AMP * Math.max(1, this.height) * float
    this.holder.rotation.z = Math.sin(t * 0.7) * 0.05 * float
    this.holder.rotation.x = Math.sin(t * 0.5 + 1) * 0.03 * float
    this.shadow.visible = this.wet < 0.3

    if (inWater !== this.inWaterNow) {
      this.inWaterNow = inWater
      // 入水大水花、出水小一點
      if (inWater) this.ranch.lake.splash(pos.x, pos.z, Math.max(this.radius, 0.35))
      else this.ranch.lake.ripple(pos.x, pos.z, Math.max(this.radius, 0.3), 0.5)
    }
    if (inWater) {
      this.rippleTimer -= dt
      if (this.rippleTimer <= 0) {
        this.rippleTimer = this.isMoving ? rand(0.35, 0.55) : rand(1.4, 2.2)
        // 水波大小有上限（暴鯉龍的半徑很大，照比例會整個湖都是白圈）
        this.ranch.lake.ripple(pos.x, pos.z, Math.min(Math.max(this.radius * 0.6, 0.22), 0.55), this.isMoving ? 0.32 : 0.22)
      }
    }
  }

  /**
   * 海底世界的水系（2026-11-17 使用者選了「A：浮在不同高度」）：浮在海床上 lo～hi 之間的某個高度，
   * 每隔一陣子挑一個新高度慢慢飄過去，平常輕輕上下漂。沒有水面、水波、水花。
   * 影子留在海床上，浮得越高影子越大、越淡，看得出誰浮在上面。移動與閃避照平面算，不管高度
   */
  private updateUndersea(dt: number, [lo, hi]: [number, number]): void {
    const pos = this.root.position
    if (this.seaAlt < 0) {
      this.seaAlt = rand(lo, hi)
      this.seaAltTarget = this.seaAlt
      this.seaAltTimer = rand(4, 10)
    }
    // 大隻的（暴鯉龍）浮太高頭會冒出海面：最高到頭頂離海面還有 0.1
    const bedNow = this.ranch.lake.bedY(pos.x, pos.z)
    const cap = Math.max(lo, Math.min(hi, (this.ranch.seaSurface ?? Infinity) - bedNow - this.height - 0.1))
    this.seaAltTimer -= dt
    if (this.seaAltTimer <= 0) {
      this.seaAltTarget = rand(lo, cap)
      this.seaAltTimer = rand(5, 12)
    }
    this.seaAltTarget = Math.min(this.seaAltTarget, cap)
    this.seaAlt += (this.seaAltTarget - this.seaAlt) * Math.min(1, dt * 0.35)
    const bed = this.ranch.lake.bedY(pos.x, pos.z)
    this.baseY = bed + this.seaAlt
    const t = this.clock * BOB_HZ * Math.PI * 2 + this.bobPhase
    pos.y = this.baseY + Math.sin(t) * BOB_AMP * Math.max(1, this.height)
    this.holder.rotation.z = Math.sin(t * 0.7) * 0.05
    this.holder.rotation.x = Math.sin(t * 0.5 + 1) * 0.03
    // 算「泡在水裡」：會飛的不再額外浮空
    this.wet = 1
    this.inWaterNow = true
    this.shadow.visible = true
    this.shadow.position.y = bed - pos.y + 0.02
    this.shadow.scale.setScalar(this.shadowSize * (1 + this.seaAlt * 0.25))
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(1 - this.seaAlt * 0.35, 0.3, 1)
  }

  private decideNext(): void {
    const roll = Math.random()
    if (roll < 0.1 && this.actions.has('happy')) {
      this.oneShot('happy')
      return
    }
    const path = this.pickTarget()
    if (!path) {
      this.toIdle()
      return
    }
    const run = roll > 0.86 && this.actions.has('run')
    this.target = path[0]
    this.route = path.slice(1)
    this.speed = run ? RUN_SPEED : WALK_SPEED
    this.activity = run ? 'run' : 'walk'
    this.timer = 14
    this.play(run ? 'run' : 'walk')
  }

  /**
   * 挑下一個目的地，回傳要依序走過的點：直線走得到的才算（中央河兩岸的陸地不相連，陸地的寵物只在自己那一岸挑）；
   * 上下棧橋例外，會先繞到橋頭（ranch-scene.ts 的 route）
   */
  private pickTarget(): THREE.Vector3[] | null {
    const terrain = this.nextTerrain()
    const here = new THREE.Vector3(this.root.position.x, 0, this.root.position.z)
    for (let i = 0; i < 8; i++) {
      const spot = this.spotFor(terrain)
      const d = spot.distanceTo(here)
      if (d < 0.8 || d > MAX_WANDER) continue
      const path = this.routeTo(here, spot)
      if (path) return path
    }
    return null
  }

  private toIdle(): void {
    this.target = null
    this.opponent = null
    if (this.asleep) {
      this.activity = 'sleep'
      this.play('sleep')
      return
    }
    if (this.waiting) {
      this.activity = 'attention'
      this.play('idle')
      return
    }
    this.activity = 'idle'
    this.timer = rand(2.5, 7)
    this.play('idle')
  }

  /**
   * 播一次某個動作。預設播完回待機；給 then 就改呼叫 then（打架用），activity 也可以指定（打架時維持 'fight'）。
   * speed 是播放速度（打架時加快）；同一個動作下次用別的速度播時會重設
   */
  private oneShot(name: string, then?: () => void, activity: Activity = 'oneshot', speed = 1): void {
    const action = this.actions.get(name)
    if (!action || !this.mixer) {
      if (then) then()
      else this.toIdle()
      return
    }
    this.target = null
    this.activity = activity
    action.reset()
    action.setEffectiveTimeScale(speed)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    this.crossTo(action)
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      this.mixer?.removeEventListener('finished', onFinished)
      if (this.current !== action) return
      if (then) then()
      else this.toIdle()
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  private play(name: string): void {
    const action = this.actions.get(name) ?? this.actions.get('idle')
    if (!action || action === this.current) return
    action.reset()
    action.setEffectiveTimeScale(1)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    this.crossTo(action)
  }

  private crossTo(action: THREE.AnimationAction): void {
    action.enabled = true
    action.setEffectiveWeight(1)
    action.play()
    if (this.current && this.current !== action) this.current.crossFadeTo(action, FADE, false)
    this.current = action
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.root.removeFromParent()
  }
}
