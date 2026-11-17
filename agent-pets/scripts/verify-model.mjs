// 檢查一個下載下來的 model.glb 是不是「單純的模型資料」，通過才會被搬進模型資料夾（fetch-models.mjs 呼叫）。
// 2026-11-13 從 verify-model.py 改寫成 Node：下載模型不再需要 Python，macOS、Windows 用同一支。
//
// 檢查項目：
// - 檔頭是 glTF 2.0 二進位格式（magic 'glTF'、version 2），檔頭寫的長度＝實際檔案大小
// - 第一個 chunk 是 JSON、解得開
// - buffers、images 都沒有指向外部的 uri（全部內嵌；不會讓 three.js 去連別的網址或讀本機其他檔案）
// - 只用到已知的 glTF 擴充
//
// 用法：node scripts/verify-model.mjs <model.glb>；通過時印出「動畫名稱、擴充」並 exit 0，不通過印原因並 exit 1。
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KNOWN_EXTENSIONS = new Set([
  'KHR_materials_emissive_strength', 'KHR_materials_unlit', 'KHR_texture_transform',
  'KHR_materials_specular', 'KHR_materials_ior', 'KHR_materials_transmission',
  'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_volume',
  'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_mesh_quantization',
  'KHR_texture_basisu', 'EXT_texture_webp', 'KHR_materials_variants', 'KHR_lights_punctual',
])

/**
 * @param {Buffer} data
 * @returns {{ ok: true, message: string } | { ok: false, message: string }}
 */
export function verifyGlb(data) {
  const fail = (message) => ({ ok: false, message: `不通過：${message}` })
  if (data.length < 20) return fail('檔案太小')
  const magic = data.subarray(0, 4).toString('latin1')
  const version = data.readUInt32LE(4)
  const length = data.readUInt32LE(8)
  if (magic !== 'glTF' || version !== 2) return fail(`不是 glTF 2.0（magic=${JSON.stringify(magic)} version=${version}）`)
  if (length !== data.length) return fail(`檔頭長度 ${length} ≠ 檔案大小 ${data.length}（下載不完整？）`)
  const chunkLength = data.readUInt32LE(12)
  if (data.subarray(16, 20).toString('latin1') !== 'JSON') return fail('第一個 chunk 不是 JSON')
  let doc
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(20, 20 + chunkLength)))
  } catch (err) {
    return fail(`JSON 解不開：${err instanceof Error ? err.message : err}`)
  }
  if (typeof doc !== 'object' || doc === null) return fail('JSON 不是物件')
  for (const kind of ['buffers', 'images']) {
    for (const item of Array.isArray(doc[kind]) ? doc[kind] : []) {
      const uri = item?.uri
      if (uri !== undefined && !(typeof uri === 'string' && uri.startsWith('data:'))) {
        return fail(`${kind} 指向外部檔案：${String(uri).slice(0, 80)}`)
      }
    }
  }
  const used = new Set(Array.isArray(doc.extensionsUsed) ? doc.extensionsUsed : [])
  const unknown = [...used].filter((ext) => !KNOWN_EXTENSIONS.has(ext)).sort()
  if (unknown.length > 0) return fail(`用到不認得的擴充：${unknown.join(', ')}`)
  const animations = (Array.isArray(doc.animations) ? doc.animations : []).map((a) => a?.name ?? '?')
  return { ok: true, message: `通過 動畫=${animations.join(',')} 擴充=${[...used].sort().join(',') || '無'}` }
}

/** @param {string} file */
export async function verifyModelFile(file) {
  try {
    return verifyGlb(await readFile(file))
  } catch (err) {
    return { ok: false, message: `不通過：讀不到檔案（${err instanceof Error ? err.message : err}）` }
  }
}

// 直接執行時才跑（被 fetch-models.mjs import 時不跑）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.log('用法：node scripts/verify-model.mjs <model.glb>')
    process.exit(1)
  }
  const result = await verifyModelFile(file)
  console.log(result.message)
  process.exit(result.ok ? 0 : 1)
}
