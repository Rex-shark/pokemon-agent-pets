/** 跟開發伺服器（vite.config.ts 的 middleware）拿品種清單；模型、頭像的網址也是那邊給的 */
import sizeClasses from '../shared/size-classes.json'
import type { SizeClass, SpeciesInfo } from '../shared/ranch-protocol'
import type { ShowcaseSpecies } from './vite.config'

export type { ShowcaseAnimation, ShowcaseSpecies } from './vite.config'

export interface SpeciesList {
  modelsDir: string
  species: ShowcaseSpecies[]
}

let cached: Promise<SpeciesList> | null = null

export function fetchSpecies(): Promise<SpeciesList> {
  cached ??= fetch('/api/species').then((r) => {
    if (!r.ok) throw new Error(`/api/species ${r.status}`)
    return r.json() as Promise<SpeciesList>
  })
  return cached
}

/** 轉成牧場本體（src/pet-actor.ts）吃的格式 */
export function toSpeciesInfo(s: ShowcaseSpecies): SpeciesInfo {
  const sizeClass = ((sizeClasses.classes as Record<string, string>)[s.id] ?? 'M') as SizeClass
  return { id: s.id, name: s.name, modelUrl: s.modelUrl, animations: s.animations.map((a) => a.name), sizeClass }
}

/** 動作的中文名稱 */
export const ACTION_LABEL: Record<string, string> = {
  idle: '待機',
  walk: '走路',
  run: '跑步',
  attack: '攻擊',
  happy: '開心',
  sleep: '睡覺',
}

export const ACTION_ORDER = ['idle', 'walk', 'run', 'attack', 'happy', 'sleep']
