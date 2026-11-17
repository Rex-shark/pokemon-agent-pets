#!/usr/bin/env node
/**
 * 產生寶可夢資料表：repo 根目錄的 docs/species.csv（Excel、Numbers 可開）、docs/species.md（IDEA 裡看）、docs/species.html（點標題排序）。
 *
 * 欄位來源：
 * - 名稱：electron/species.ts 的 NAMES（繁中、台灣）
 * - 屬性：06wj/pokemon 的 src/content/pokemonTypes.ts（原作者取自官方繁中圖鑑；固定 commit）
 * - 官方身高、體重：PokeAPI 的 data/v2/csv/pokemon.csv（固定 commit；身高單位 0.1 m、體重單位 0.1 kg）
 * - 動作、動作長度、模型大小：直接讀本機模型資料夾的 GLB
 *
 * 模型高度用「待機動作第一格」量，跟 App 的 src/pet-actor.ts 一樣（不是綁定姿勢）。
 * three.js 在 Node 裡沒有圖片可以解碼，所以先把 GLB 裡的貼圖拿掉再解析（只量大小、讀動作，用不到貼圖）。
 *
 * 用法（在 agent-pets/ 底下）：node scripts/species-table.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 專案裡的 models/（跟 electron/species.ts 一樣，PET_MODELS_DIR 可以改） */
const MODELS_DIR = process.env.PET_MODELS_DIR || path.join(ROOT, 'models')
/** 資料表放 repo 根目錄的 docs/（跟桌寵模組 agent-pets/ 並排） */
const DOCS_DIR = path.join(ROOT, '..', 'docs')
const TYPES_URL = 'https://raw.githubusercontent.com/06wj/pokemon/00d96f7f18894055e7f1db44fa0df6462e5e4c8a/src/content/pokemonTypes.ts'
const POKEAPI_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/5cbeb3f3eb55a9b86da52c4869336f9d61fdd6d7/data/v2/csv/pokemon.csv'

/**
 * 尺寸級距（2026-11-11 使用者指定）：
 * - LL：手動指定（MANUAL_CLASS），目前是大岩蛇、卡比獸、暴鯉龍
 * - 其餘照「待機姿勢的模型高度」由矮到高分：最矮的 30% 是 S、接著 40% 是 M、最高的 30% 是 L
 * 結果寫進 shared/size-classes.json，App（electron/species.ts）讀它決定每隻在牧場上多大。
 */
const MANUAL_CLASS = { '095': 'LL', '143': 'LL', '130': 'LL' }
const SHARES = [
  { label: 'S', share: 0.3 },
  { label: 'M', share: 0.4 },
  { label: 'L', share: 0.3 },
]
const CLASS_ORDER = ['S', 'M', 'L', 'LL']

/** 依待機高度把沒有手動指定的分成 S／M／L（照比例切，四捨五入，最後一級拿剩下的） */
function assignClasses(rows) {
  const auto = rows.filter((r) => !MANUAL_CLASS[r.id]).sort((a, b) => a.modelH - b.modelH || a.id.localeCompare(b.id))
  let i = 0
  SHARES.forEach(({ label, share }, k) => {
    const n = k === SHARES.length - 1 ? auto.length - i : Math.round(auto.length * share)
    for (const r of auto.slice(i, i + n)) r.sizeClass = label
    i += n
  })
  for (const r of rows) if (MANUAL_CLASS[r.id]) r.sizeClass = MANUAL_CLASS[r.id]
}

const TYPE_ZH = {
  normal: '一般', grass: '草', fire: '火', water: '水', electric: '電', bug: '蟲', flying: '飛行', rock: '岩石',
  poison: '毒', ground: '地面', ice: '冰', fighting: '格鬥', psychic: '超能力', ghost: '幽靈', dragon: '龍', steel: '鋼', fairy: '妖精',
}
const ANIM_ZH = { idle: '待機', walk: '走', run: '跑', attack: '攻擊', happy: '開心', sleep: '睡覺' }
const ANIM_ORDER = ['idle', 'walk', 'run', 'attack', 'happy', 'sleep']

function readNames() {
  const src = readFileSync(path.join(ROOT, 'electron', 'species.ts'), 'utf8')
  const block = src.match(/const NAMES = \[([\s\S]*?)\n\]/)[1]
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.text()
}

async function readTypes() {
  const src = await fetchText(TYPES_URL)
  // 取 pokemonTypes = 後面第一個完整的 [...]（數括號；字串裡不會有括號）
  const start = src.indexOf('[', src.indexOf('pokemonTypes ='))
  let depth = 0
  let end = start
  for (; end < src.length; end++) {
    if (src[end] === '[') depth++
    else if (src[end] === ']' && --depth === 0) break
  }
  return JSON.parse(src.slice(start, end + 1))
}

async function readOfficial() {
  const rows = (await fetchText(POKEAPI_URL)).trim().split('\n').slice(1)
  const byId = new Map()
  for (const row of rows) {
    const [id, , , height, weight] = row.split(',')
    if (Number(id) <= 151) byId.set(Number(id), { heightM: Number(height) / 10, weightKg: Number(weight) / 10 })
  }
  return byId
}

/** 拿掉貼圖後重新組成 GLB（Node 裡沒有 Image 可以解碼貼圖） */
function stripTextures(glb) {
  const jsonLen = glb.readUInt32LE(12)
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'))
  delete doc.images
  delete doc.textures
  delete doc.samplers
  for (const m of doc.materials ?? []) {
    delete m.normalTexture
    delete m.occlusionTexture
    delete m.emissiveTexture
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture
      delete m.pbrMetallicRoughness.metallicRoughnessTexture
    }
    delete m.extensions
  }
  let json = Buffer.from(JSON.stringify(doc), 'utf8')
  const pad = (4 - (json.length % 4)) % 4
  json = Buffer.concat([json, Buffer.alloc(pad, 0x20)])
  const rest = glb.subarray(20 + jsonLen) // BIN chunk（含它自己的 chunk 標頭）
  const header = Buffer.alloc(20)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(20 + json.length + rest.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.write('JSON', 16, 'ascii')
  const out = Buffer.concat([header, json, rest])
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}

function parse(arrayBuffer) {
  return new Promise((resolve, reject) => new GLTFLoader().parse(arrayBuffer, '', resolve, reject))
}

/** 待機動作第一格的外框（跟 App 一樣：先更新骨骼矩陣再量） */
function measureIdle(gltf) {
  const scene = gltf.scene
  const idle = gltf.animations.find((a) => a.name.toLowerCase() === 'idle')
  if (idle) {
    const mixer = new THREE.AnimationMixer(scene)
    mixer.clipAction(idle).play()
    mixer.update(0)
  }
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (o.isSkinnedMesh) o.skeleton.update()
  })
  return new THREE.Box3().setFromObject(scene, true).getSize(new THREE.Vector3())
}

function csvCell(v) {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

const fmt = (n, d = 2) => n.toFixed(d)

async function main() {
  const names = readNames()
  const [types, official] = await Promise.all([readTypes(), readOfficial()])
  const ids = readdirSync(MODELS_DIR).filter((n) => /^\d{3}$/.test(n)).sort()
  const rows = []
  for (const id of ids) {
    const file = path.join(MODELS_DIR, id, 'model.glb')
    const gltf = await parse(stripTextures(readFileSync(file)))
    const size = measureIdle(gltf)
    const clips = new Map(gltf.animations.map((a) => [a.name.toLowerCase(), a.duration]))
    const anims = ANIM_ORDER.filter((a) => clips.has(a))
    const n = Number(id)
    const off = official.get(n)
    rows.push({
      id,
      name: names[n - 1],
      types: (types[n - 1] ?? []).map((t) => TYPE_ZH[t] ?? t).join('／'),
      heightM: off?.heightM,
      weightKg: off?.weightKg,
      modelH: size.y,
      modelW: size.x,
      modelD: size.z,
      sizeClass: '',
      anims,
      durations: anims.map((a) => clips.get(a)),
      canSleep: clips.has('sleep'),
      mb: statSync(file).size / 1024 / 1024,
    })
    process.stdout.write(`\r量好 ${rows.length}/${ids.length}`)
  }
  process.stdout.write('\n')
  assignClasses(rows)

  const headers = ['編號', '名稱', '屬性', '官方身高(m)', '官方體重(kg)', '模型高度', '模型寬', '模型深', '尺寸級距', '動作', '各動作長度(秒)', '會睡覺', '模型檔(MB)']
  const toCells = (r) => [
    r.id, r.name, r.types, fmt(r.heightM, 1), fmt(r.weightKg, 1), fmt(r.modelH), fmt(r.modelW), fmt(r.modelD), r.sizeClass,
    r.anims.map((a) => ANIM_ZH[a]).join('、'), r.durations.map((d) => fmt(d, 1)).join('、'), r.canSleep ? '是' : '否', fmt(r.mb, 1),
  ]

  const outDir = DOCS_DIR
  mkdirSync(outDir, { recursive: true })
  // BOM：Excel 開 UTF-8 CSV 才不會變亂碼
  const csv = '﻿' + [headers, ...rows.map(toCells)].map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n'
  writeFileSync(path.join(outDir, 'species.csv'), csv)

  const counts = Object.fromEntries(CLASS_ORDER.map((c) => [c, rows.filter((r) => r.sizeClass === c).length]))
  // 各級最矮、最高的模型高度（文件上寫切點用）
  const range = (c) => {
    const hs = rows.filter((r) => r.sizeClass === c).map((r) => r.modelH)
    return `${fmt(Math.min(...hs))}～${fmt(Math.max(...hs))}`
  }
  const classNote = `LL 手動指定（${rows.filter((r) => r.sizeClass === 'LL').map((r) => r.name).join('、')}）；其餘照待機高度由矮到高：S 30%（${counts.S} 隻，${range('S')}）、M 40%（${counts.M} 隻，${range('M')}）、L 30%（${counts.L} 隻，${range('L')}）`
  const sizeMap = Object.fromEntries(rows.map((r) => [r.id, r.sizeClass]))
  writeFileSync(
    path.join(ROOT, 'shared', 'size-classes.json'),
    JSON.stringify({ _note: '由 scripts/species-table.mjs 產生，不要手改；手動指定改腳本的 MANUAL_CLASS', classes: sizeMap }, null, 2) + '\n',
  )
  const md = [
    '# 寶可夢資料表',
    '',
    '> 由 `scripts/species-table.mjs` 產生，不要手改（重跑：在 agent-pets/ 底下 `node scripts/species-table.mjs`）。',
    '>',
    '> - 官方身高、體重：PokeAPI（固定 commit `5cbeb3f`）；屬性：06wj/pokemon（原作者取自官方繁中圖鑑）。',
    '> - 模型高度、寬、深：模型自己的單位（遊戲比例，已經壓縮過，不是公尺），用待機動作第一格量，跟 App 量法一樣。',
    `> - 尺寸級距（App 用這個決定每隻在牧場上多大，見 shared/size-classes.json）：${classNote}。`,
    `> - 會睡覺：${rows.filter((r) => r.canSleep).length} 隻；沒有睡覺動作的 ${rows.filter((r) => !r.canSleep).length} 隻在 agent 很久沒動靜時照常走動。`,
    '',
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${toCells(r).join(' | ')} |`),
    '',
  ].join('\n')
  writeFileSync(path.join(outDir, 'species.md'), md)

  writeFileSync(path.join(outDir, 'species.html'), buildHtml(headers, rows, toCells, counts, classNote))
  console.log(`寫好 ../docs/species.csv、species.md、species.html、shared/size-classes.json（${rows.length} 隻；S ${counts.S}、M ${counts.M}、L ${counts.L}、LL ${counts.LL}）`)
}

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * 靜態網頁版：一個檔案、不連網，雙擊就能開。功能只有「點欄位標題排序」（再點一次反過來），跟 Excel 的排序一樣。
 * 每格的排序值放在 data-sort：數字欄照數字排、級距照 S＜M＜L、動作照數量、動作長度照總長、文字照繁中排序。
 */
function buildHtml(headers, rows, toCells, counts, classNote) {
  const sizeRank = { S: 1, M: 2, L: 3, LL: 4 }
  const sortValues = (r) => [
    Number(r.id), r.name, r.types, r.heightM, r.weightKg, r.modelH, r.modelW, r.modelD, sizeRank[r.sizeClass],
    r.anims.length, r.durations.reduce((a, b) => a + b, 0), r.canSleep ? 1 : 0, r.mb,
  ]
  const numeric = [true, false, false, true, true, true, true, true, true, true, true, true, true]
  const body = rows
    .map((r) => {
      const cells = toCells(r)
      const keys = sortValues(r)
      return `<tr>${cells.map((c, i) => `<td${numeric[i] ? ' class="num"' : ''} data-sort="${escapeHtml(keys[i])}">${escapeHtml(c)}</td>`).join('')}</tr>`
    })
    .join('\n')
  const head = headers
    .map((h, i) => `<th data-col="${i}" data-type="${numeric[i] ? 'num' : 'text'}"${numeric[i] ? ' class="num"' : ''} title="點一下排序，再點一次反過來">${escapeHtml(h)}<span class="arrow"></span></th>`)
    .join('')
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>寶可夢資料表</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --head: #f6f8fa; --stripe: #f9fafb; --hover: #eef4ff; --accent: #0969da; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --head: #161b22; --stripe: #11161d; --hover: #1a2433; --accent: #4493f8; }
  }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, 'PingFang TC', 'Heiti TC', sans-serif; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .notes { color: var(--muted); font-size: 12.5px; margin: 0 0 16px; padding-left: 18px; }
  .wrap { overflow: auto; max-height: calc(100vh - 170px); border: 1px solid var(--line); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; white-space: nowrap; }
  th, td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; }
  th { position: sticky; top: 0; background: var(--head); cursor: pointer; user-select: none; font-weight: 600; z-index: 1; }
  th:hover { color: var(--accent); }
  th.sorted { color: var(--accent); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: var(--stripe); }
  tbody tr:hover { background: var(--hover); }
  .arrow { display: inline-block; width: 1em; text-align: center; font-size: 11px; }
</style>
</head>
<body>
<h1>寶可夢資料表（${rows.length} 隻）</h1>
<ul class="notes">
  <li>點欄位標題排序，再點一次反過來。由 <code>scripts/species-table.mjs</code> 產生，不要手改。</li>
  <li>官方身高、體重：PokeAPI（固定 commit 5cbeb3f）；屬性：06wj/pokemon（原作者取自官方繁中圖鑑）。</li>
  <li>模型高度、寬、深是模型自己的單位（遊戲比例，不是公尺），用待機動作第一格量。尺寸級距（App 用這個決定在牧場上多大）：${escapeHtml(classNote)}。</li>
</ul>
<div class="wrap">
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>
<script>
  const tbody = document.querySelector('tbody')
  const ths = [...document.querySelectorAll('th')]
  const collator = new Intl.Collator('zh-Hant-TW')
  let state = { col: 0, dir: 1 }
  function render() {
    const { col, dir } = state
    const numeric = ths[col].dataset.type === 'num'
    const rows = [...tbody.rows]
    rows.sort((a, b) => {
      const x = a.cells[col].dataset.sort
      const y = b.cells[col].dataset.sort
      const d = numeric ? Number(x) - Number(y) : collator.compare(x, y)
      // 一樣的時候照編號，排序結果才穩定
      return d * dir || Number(a.cells[0].dataset.sort) - Number(b.cells[0].dataset.sort)
    })
    tbody.append(...rows)
    for (const th of ths) {
      const on = Number(th.dataset.col) === col
      th.classList.toggle('sorted', on)
      th.querySelector('.arrow').textContent = on ? (dir > 0 ? '▲' : '▼') : ''
    }
  }
  for (const th of ths) {
    th.addEventListener('click', () => {
      const col = Number(th.dataset.col)
      // 數字欄第一次點從大排到小（看最重、最高的通常比較想先看），文字欄從頭排
      state = state.col === col ? { col, dir: -state.dir } : { col, dir: th.dataset.type === 'num' && col !== 0 ? -1 : 1 }
      render()
    })
  }
  render()
</script>
</body>
</html>
`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
