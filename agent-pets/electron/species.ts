/**
 * 牧場上可以認養的寶可夢：掃描模型資料夾（MODELS_DIR），有 <編號>/model.glb 的才算。
 *
 * 模型來源是 06wj/pokemon（scripts/fetch-models.mjs 抓的），只給本機自用、不進 git（.gitignore 的 /models/）。
 * 動作清單讀同一個資料夾的 animatedModels.json（原專案的清單）；讀不到就當成只有 idle、walk。
 *
 * 模型資料夾放在專案裡的 models/（2026-11-12 使用者：模型指向自己專案內）。找的順序：
 * 1. 環境變數 PET_MODELS_DIR
 * 2. 從這支程式所在的位置往上找「有 models/animatedModels.json 的資料夾」：
 *    開發模式（dist-electron/）、展示網站（electron/）、從 release/ 開的打包 App（.app 裡的 app.asar）都找得到專案根目錄
 * 3. 都找不到（例如 App 被搬到別的地方）：存檔目錄底下的 models/（macOS 是 ~/Library/Application Support/Pokemon Ranch Pets/models，
 *    Windows 是 %APPDATA%\Pokemon Ranch Pets\models；見 electron/platform/）
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sizeClasses from '../shared/size-classes.json'
import type { SizeClass, SpeciesInfo } from '../shared/ranch-protocol'
import { PLATFORM } from './platform'

/** 測試可指定獨立存檔目錄，避免假事件寫進使用者的牧場。 */
export const APP_DATA_DIR = process.env.PET_DATA_DIR
  ? path.resolve(process.env.PET_DATA_DIR)
  : PLATFORM.appDataDir
export const MODELS_DIR = process.env.PET_MODELS_DIR || findProjectModels() || path.join(APP_DATA_DIR, 'models')

/** 往上找專案裡的 models/（打包的 App 在 <專案>/release/mac-arm64/….app/Contents/Resources/app.asar/dist-electron 往上 7 層、
 * Windows 是 <專案>/release/win-unpacked/resources/app.asar/dist-electron 往上 5 層） */
function findProjectModels(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'models')
    if (existsSync(path.join(candidate, 'animatedModels.json'))) return candidate
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}
export const MODEL_SCHEME = 'petmodels'

/** 第一代 151 隻的繁中（台灣）名稱，依圖鑑編號排列 */
const NAMES = [
  '妙蛙種子', '妙蛙草', '妙蛙花', '小火龍', '火恐龍', '噴火龍', '傑尼龜', '卡咪龜', '水箭龜', '綠毛蟲',
  '鐵甲蛹', '巴大蝶', '獨角蟲', '鐵殼蛹', '大針蜂', '波波', '比比鳥', '大比鳥', '小拉達', '拉達',
  '烈雀', '大嘴雀', '阿柏蛇', '阿柏怪', '皮卡丘', '雷丘', '穿山鼠', '穿山王', '尼多蘭', '尼多娜',
  '尼多后', '尼多朗', '尼多力諾', '尼多王', '皮皮', '皮可西', '六尾', '九尾', '胖丁', '胖可丁',
  '超音蝠', '大嘴蝠', '走路草', '臭臭花', '霸王花', '派拉斯', '派拉斯特', '毛球', '摩魯蛾', '地鼠',
  '三地鼠', '喵喵', '貓老大', '可達鴨', '哥達鴨', '猴怪', '火爆猴', '卡蒂狗', '風速狗', '蚊香蝌蚪',
  '蚊香君', '蚊香泳士', '凱西', '勇基拉', '胡地', '腕力', '豪力', '怪力', '喇叭芽', '口呆花',
  '大食花', '瑪瑙水母', '毒刺水母', '小拳石', '隆隆石', '隆隆岩', '小火馬', '烈焰馬', '呆呆獸', '呆殼獸',
  '小磁怪', '三合一磁怪', '大蔥鴨', '嘟嘟', '嘟嘟利', '小海獅', '白海獅', '臭泥', '臭臭泥', '大舌貝',
  '刺甲貝', '鬼斯', '鬼斯通', '耿鬼', '大岩蛇', '催眠貘', '引夢貘人', '大鉗蟹', '巨鉗蟹', '霹靂電球',
  '頑皮雷彈', '蛋蛋', '椰蛋樹', '卡拉卡拉', '嘎啦嘎啦', '飛腿郎', '快拳郎', '大舌頭', '瓦斯彈', '雙彈瓦斯',
  '獨角犀牛', '鑽角犀獸', '吉利蛋', '蔓藤怪', '袋獸', '墨海馬', '海刺龍', '角金魚', '金魚王', '海星星',
  '寶石海星', '魔牆人偶', '飛天螳螂', '迷唇姐', '電擊獸', '鴨嘴火獸', '凱羅斯', '肯泰羅', '鯉魚王', '暴鯉龍',
  '拉普拉斯', '百變怪', '伊布', '水伊布', '雷伊布', '火伊布', '多邊獸', '菊石獸', '多刺菊石獸', '化石盔',
  '鐮刀盔', '化石翼龍', '卡比獸', '急凍鳥', '閃電鳥', '火焰鳥', '迷你龍', '哈克龍', '快龍', '超夢',
  '夢幻',
]

export function speciesName(id: string): string {
  return NAMES[Number(id) - 1] ?? `#${id}`
}

/** 原專案 animatedModels.json 的格式（只取用得到的欄位） */
type Manifest = Record<string, { animations?: { name?: unknown }[] }>

async function readManifest(): Promise<Manifest> {
  try {
    const data: unknown = JSON.parse(await readFile(path.join(MODELS_DIR, 'animatedModels.json'), 'utf8'))
    return typeof data === 'object' && data !== null ? (data as Manifest) : {}
  } catch {
    return {}
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

const SIZE_CLASSES = new Set<SizeClass>(['S', 'M', 'L', 'LL'])

/** 沒在表上的（新加的模型、表還沒重產）當成 M */
function sizeClassOf(id: string): SizeClass {
  const c = (sizeClasses.classes as Record<string, string>)[id] as SizeClass | undefined
  return c && SIZE_CLASSES.has(c) ? c : 'M'
}

export async function scanSpecies(): Promise<SpeciesInfo[]> {
  let entries: string[]
  try {
    entries = await readdir(MODELS_DIR)
  } catch {
    return []
  }
  const manifest = await readManifest()
  const species: SpeciesInfo[] = []
  for (const id of entries.filter((name) => /^\d{3}$/.test(name)).sort()) {
    if (!(await isFile(path.join(MODELS_DIR, id, 'model.glb')))) continue
    const animations = (manifest[id]?.animations ?? [])
      .map((a) => a.name)
      .filter((name): name is string => typeof name === 'string')
    species.push({
      id,
      name: speciesName(id),
      modelUrl: `${MODEL_SCHEME}://local/${id}/model.glb`,
      animations: animations.length > 0 ? animations : ['idle', 'walk'],
      sizeClass: sizeClassOf(id),
    })
  }
  return species
}
