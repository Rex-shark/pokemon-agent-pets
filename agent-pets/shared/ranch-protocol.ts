/**
 * 主行程 ↔ renderer 的訊息格式。主行程、preload、renderer 都引用這一份。
 *
 * 主行程每收到一個 hook 事件就送一次完整快照（牧場上所有寵物）；
 * 寵物怎麼動、泡泡怎麼畫、播什麼音效由 renderer 決定。
 */

export const RANCH_UPDATE_CHANNEL = 'ranch:update'
export const RANCH_CONFIG_CHANNEL = 'ranch:config'
export const RANCH_MOUSE_THROUGH_CHANNEL = 'ranch:mouse-through'
export const RANCH_DRAG_CHANNEL = 'ranch:drag'
/** 主行程 → renderer：螢幕變動後的新取景（桌布模式 Dock、選單列變了），renderer 原地重新取景、不重新載入 */
export const RANCH_FRAME_CHANNEL = 'ranch:frame'

export type RanchDragPhase = 'start' | 'end'

/**
 * - idle：沒在做事
 * - busy：在做事（頭上有雲朵泡泡）
 * - waiting：在等你（核准權限、回答問題、批准計畫）→ 黃色＋提示音
 * - error：剛剛有工具失敗 → 紅色＋錯誤音
 * - compacting：整理記憶（壓縮對話）→ 淡紫
 */
export type AgentMode = 'idle' | 'busy' | 'waiting' | 'error' | 'compacting'

export type AgentProvider = 'claude' | 'codex'

/** 一種寶可夢（模型資料夾裡有的才會出現） */
export interface SpeciesInfo {
  /** 圖鑑編號，例如 "025" */
  id: string
  /** 繁中名稱，例如「皮卡丘」 */
  name: string
  /** petmodels:// 的模型網址 */
  modelUrl: string
  /** 模型有的動作（idle、walk、run、attack、happy、sleep 的子集合） */
  animations: string[]
  /** 在牧場上的大小級距（shared/size-classes.json，scripts/species-table.mjs 產生） */
  sizeClass: SizeClass
}

/** S／M／L 照待機高度 30%／40%／30% 自動分；LL 是使用者手動指定的大隻（大岩蛇、卡比獸、暴鯉龍） */
export type SizeClass = 'S' | 'M' | 'L' | 'LL'

/** float：置頂的小牧場（可拖曳、可點寵物）；wallpaper：桌布模式（桌面背景層、鋪滿螢幕、收不到滑鼠） */
export type RanchMode = 'float' | 'wallpaper'

/**
 * 牧場地圖（src/ranch-maps.ts）：都是等角的正方形小島，差在水放在哪裡。
 * lake-left 左側海（海灘；id 沿用原本的「左側湖」，設定檔裡存的是這個）、lake-center 火山口湖（隆起的火山、湖在山頂；id 沿用原本的「中央湖」）、river 中央河（河畔露營：河從左角流到右角、中段微微 S 彎，上岸是有營地的沙地）、snow 雪地（雪國小屋：花生形的湖、小木屋、松林、雪屋、雪人、飄雪）、
 * sakura 日式賞櫻（池泉庭園：右上的河與池、左上邊緣的太鼓橋與鳥居、左邊的枝垂櫻、飄花瓣）、
 * islet 中央島（2026-11-13 加的第六張：四面環海的沙島，一棵大椰子樹）、
 * moon 月面基地（2026-11-16 加的第七張：月面上一個大玻璃罩、中央水池、通到邊緣的通道與門，罩外有皮皮、皮可西與胖丁）、
 * undersea 海底世界（2026-11-17 加的第八張：整座島沉在海裡，中間玻璃罩裡是陸地，水系在罩外浮在不同高度）
 */
export type RanchMapId = 'lake-left' | 'lake-center' | 'river' | 'snow' | 'sakura' | 'islet' | 'moon' | 'undersea'

/** 地圖在選單上的名稱（照這個順序列） */
export const RANCH_MAP_LABELS: { id: RanchMapId; label: string }[] = [
  { id: 'lake-left', label: '左側海' },
  { id: 'lake-center', label: '火山口湖' },
  { id: 'river', label: '中央河' },
  { id: 'snow', label: '雪地' },
  { id: 'sakura', label: '日式賞櫻' },
  { id: 'islet', label: '中央島' },
  { id: 'moon', label: '月面基地' },
  { id: 'undersea', label: '海底世界' },
]

export function isRanchMapId(value: unknown): value is RanchMapId {
  return RANCH_MAP_LABELS.some((m) => m.id === value)
}

/** 設定裡的地圖選擇：某一張，或 random（2026-11-12 使用者「每次啟動地形用隨機」：App 啟動時抽一張，預設） */
export type RanchMapChoice = RanchMapId | 'random'

export function isRanchMapChoice(value: unknown): value is RanchMapChoice {
  return value === 'random' || isRanchMapId(value)
}

/**
 * 小島在畫面上的取景（renderer 的 RanchScene.frameIsland → src/iso-view.ts）：
 * width：左右撐到畫面寬度的比例；bottom：小島底部在 NDC 的 -bottom（1 = 貼齊畫面底）；top：畫面上方保留給泡泡的比例。
 */
export interface IslandFrame {
  width: number
  bottom: number
  top: number
}

export interface RanchConfig {
  mode: RanchMode
  frame: IslandFrame
  /** 用哪一張地圖 */
  map: RanchMapId
  species: SpeciesInfo[]
  /** 模型資料夾（畫面上提示用） */
  modelsDir: string
  /** 多久沒有 hook 就睡覺（毫秒） */
  sleepAfterMs: number
  /** 兩隻正面撞上時開打的機率（0 ~ 1） */
  fightChance: number
}

/** 牧場上的一隻寵物＝一個主 agent（Claude／Codex session）。session 結束了寵物也留著。 */
export interface PetView {
  /** 牧場內的識別碼；Codex 使用 codex:<session_id>，Claude 保留舊值 */
  sessionId: string
  provider: AgentProvider
  speciesId: string
  /** 側欄標題；查不到是 null */
  title: string | null
  /** session 的工作目錄最後一層（沒有標題時顯示用） */
  project: string | null
  /** session 還活著（收過事件、沒收到 SessionEnd） */
  active: boolean
  mode: AgentMode
  /** 在做什麼（泡泡內容）；idle 時是 null */
  label: string | null
  /** 最後一次收到這個 agent 的 hook 的時間（睡覺判斷用） */
  lastEventAt: number
  /** 認養的時間 */
  adoptedAt: number
}

/** 這個事件要 renderer 播一次的提醒 */
export type RanchCue = 'done' | 'error' | 'waiting'

export interface RanchUpdate {
  pets: PetView[]
  /** 剛發生的提醒；沒有是 null */
  cue: { sessionId: string; kind: RanchCue } | null
}

export interface RanchBridge {
  getConfig(): Promise<RanchConfig>
  onUpdate(callback: (update: RanchUpdate) => void): () => void
  onFrame(callback: (frame: IslandFrame) => void): () => void
  setMouseThrough(through: boolean): void
  drag(phase: RanchDragPhase): void
}
