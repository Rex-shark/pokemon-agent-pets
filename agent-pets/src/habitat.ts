/**
 * 每隻寶可夢住哪裡（2026-11-11 水系原型）：
 * - water（水中）：沒有腳、離不開水的，只在湖裡游：魚、水母、貝殼、海星、海馬、菊石，加上拉普拉斯（鰭）、
 *   迷你龍、哈克龍（龍屬性，但沒有腳、住在水裡，是名單裡唯二不是水屬性的）
 * - amphibious（水陸兩棲）：其餘的水屬性（有腳的龜、鴨、蝌蚪、海獅、螃蟹、化石盔…），平常在草地上，偶爾下水游一下
 * - land（陸地）：其他全部，不會下水
 *
 * 規則：「屬性含水 → 兩棲」＋手動的「水中」名單。水屬性的清單直接寫在這裡（不用在 App 裡查屬性），
 * 來源是 repo 根目錄 docs/species.md 的屬性欄；要調整誰下不下水就改這兩份名單。
 */
export type Habitat = 'land' | 'amphibious' | 'water'

/** 只在水中（17 隻） */
const WATER_ONLY = new Set([
  '072', // 瑪瑙水母
  '073', // 毒刺水母
  '090', // 大舌貝
  '091', // 刺甲貝
  '116', // 墨海馬
  '117', // 海刺龍
  '118', // 角金魚
  '119', // 金魚王
  '120', // 海星星
  '121', // 寶石海星
  '129', // 鯉魚王
  '130', // 暴鯉龍
  '131', // 拉普拉斯
  '138', // 菊石獸
  '139', // 多刺菊石獸
  '147', // 迷你龍（龍）
  '148', // 哈克龍（龍）
])

/** 水陸兩棲（17 隻）：上面以外的水屬性 */
const AMPHIBIOUS = new Set([
  '007', // 傑尼龜
  '008', // 卡咪龜
  '009', // 水箭龜
  '054', // 可達鴨
  '055', // 哥達鴨
  '060', // 蚊香蝌蚪
  '061', // 蚊香君
  '062', // 蚊香泳士
  '079', // 呆呆獸
  '080', // 呆殼獸
  '086', // 小海獅
  '087', // 白海獅
  '098', // 大鉗蟹
  '099', // 巨鉗蟹
  '134', // 水伊布
  '140', // 化石盔
  '141', // 鐮刀盔
])

export function habitatOf(speciesId: string): Habitat {
  if (WATER_ONLY.has(speciesId)) return 'water'
  if (AMPHIBIOUS.has(speciesId)) return 'amphibious'
  return 'land'
}

/**
 * 在水裡時身體沉下去多少（身高的比例）：水中的只露出背、鰭、頭；兩棲的露出上半身。
 * 湖不夠深時會停在湖底（大隻的暴鯉龍、拉普拉斯會露比較多）。個別品種要調再加到 SINK_BY_SPECIES。
 */
export const SWIM_SINK: Record<Exclude<Habitat, 'land'>, number> = { water: 0.6, amphibious: 0.5 }
const SINK_BY_SPECIES: Record<string, number> = {}

export function swimSink(speciesId: string, habitat: Habitat): number {
  if (habitat === 'land') return 0
  return SINK_BY_SPECIES[speciesId] ?? SWIM_SINK[habitat]
}
