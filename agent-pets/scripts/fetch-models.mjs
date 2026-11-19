// 下載寶可夢模型到專案裡的 models/（npm run setup:models）。
// 2026-11-13 從 fetch-models.sh（zsh＋curl＋python3＋xxd）改寫成 Node：macOS、Windows 用同一支，只需要 Node 22 以上。
//
// 來源：github.com/06wj/pokemon（固定在下面的 commit，不會因為原作者之後改檔而抓到不一樣的東西）。
//
// 🔴 2026-11 起這支腳本「照原樣跑會全部失敗」：原作者把 06wj/pokemon 關掉了，下面 BASE 指的網址回 404。
//    這裡刻意沒有改程式（使用者的決定：腳本不改，由要下載的人或 agent 看懂原因後自己改）。要用之前請先讀完這段：
//
//    1. 為什麼還抓得到：GitHub 上同一個專案的 fork 共用同一份儲存，原作者推過的那個 commit 還留在 fork 網路裡，
//       從任何一個還在的 fork 用 commit 編號都取得到。目前確認可用的是 Guardwu2015/pokemon
//       （2026-11 實際下載驗證過，151 隻 model.glb、icon.png 與 animatedModels.json 的內容跟原本的完全相同）。
//    2. 要改哪裡：只改下面 BASE 那一行的帳號，把 06wj 換成 Guardwu2015；COMMIT 不要動。改完應該是
//         https://raw.githubusercontent.com/Guardwu2015/pokemon/${COMMIT}
//    3. 不要做的事：
//       - 不要拿掉或換掉 COMMIT。那個 fork 自己的 master 分支是 2018 年的舊版（148 隻、沒有動作、.gltf＋.bin），這個專案不能用。
//       - 改完還是 404 的話，代表那個 commit 已經被 GitHub 清掉、或那個 fork 也不在了。停下來告訴使用者來源失效，
//         請他自己提供模型；不要改去抓別的版本、別的來源，或自己找檔案充數。
//       - 一樣要先問過使用者才下載（docs/install.md 第 2 步）。
//    4. 改完先抓一隻確認抓得到、檢查會過，再抓全部：node scripts/fetch-models.mjs 025
//
// 模型的角色權利屬於原權利方，原專案不授予使用權：🔴 只給本機自用、不進 git、不要分享出去。
//
// 安全：只下載資料檔（model.glb、icon.png、animatedModels.json），不 clone、不執行原專案的任何程式；
// 每個 GLB 先下載到暫存資料夾，用 verify-model.mjs 檢查是純模型資料（glTF 2.0、全部內嵌、沒有外部網址）才搬進去。
//
// 用法：
//   npm run setup:models                       抓全部 151 隻（約 470 MB；已經抓過、通過檢查的會跳過，可以中斷後重跑）
//   node scripts/fetch-models.mjs 025 133      只抓指定編號
//   環境變數 PET_MODELS_DIR 可以改存放位置
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyModelFile } from './verify-model.mjs'

const COMMIT = '00d96f7f18894055e7f1db44fa0df6462e5e4c8a'
const BASE = `https://raw.githubusercontent.com/06wj/pokemon/${COMMIT}`
// 放在專案裡的 models/（.gitignore 排除；electron/species.ts 的 MODELS_DIR 讀這裡）
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.resolve(process.env.PET_MODELS_DIR || path.join(PROJECT_ROOT, 'models'))
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const RETRIES = 5

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 下載到檔案；失敗重試（跟原本 curl --retry 5 --retry-delay 2 一樣） */
async function fetchTo(url, file) {
  let lastError
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(2000)
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`)
        // 404 這類不會因為重試變好
        if (response.status >= 400 && response.status < 500 && response.status !== 429) break
        continue
      }
      await writeFile(file, Buffer.from(await response.arrayBuffer()))
      return
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function nonEmpty(file) {
  try {
    return (await stat(file)).size > 0
  } catch {
    return false
  }
}

/** 搬檔：同一顆磁碟用 rename；暫存資料夾在別顆磁碟（Windows 常見 C: → D:）時 rename 會失敗，改成複製 */
async function move(from, to) {
  try {
    await rename(from, to)
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

async function main() {
  await mkdir(DEST, { recursive: true })
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'pokemon-models-'))
  try {
    const manifest = path.join(DEST, 'animatedModels.json')
    if (!(await nonEmpty(manifest))) {
      const file = path.join(tmp, 'animatedModels.json')
      try {
        await fetchTo(`${BASE}/src/content/animatedModels.json`, file)
      } catch {
        console.log('清單下載失敗')
        return 1
      }
      try {
        const data = JSON.parse(await readFile(file, 'utf8'))
        if (typeof data !== 'object' || data === null || Array.isArray(data) || Object.keys(data).length === 0) throw new Error()
      } catch {
        console.log('清單格式不對')
        return 1
      }
      await move(file, manifest)
    }

    const ids = process.argv.length > 2 ? process.argv.slice(2) : Array.from({ length: 151 }, (_, i) => String(i + 1).padStart(3, '0'))
    let ok = 0
    let skipped = 0
    const failed = []
    for (const id of ids) {
      if (!/^\d{3}$/.test(id)) {
        console.log(`編號要三位數：${id}`)
        failed.push(id)
        continue
      }
      const target = path.join(DEST, id)
      if ((await nonEmpty(path.join(target, 'model.glb'))) && (await verifyModelFile(path.join(target, 'model.glb'))).ok) {
        skipped++
        continue
      }
      const work = path.join(tmp, id)
      await mkdir(work, { recursive: true })
      const glb = path.join(work, 'model.glb')
      try {
        await fetchTo(`${BASE}/public/models/${id}/model.glb`, glb)
      } catch {
        console.log(`#${id} 下載失敗`)
        failed.push(id)
        continue
      }
      const result = await verifyModelFile(glb)
      if (!result.ok) {
        console.log(`#${id} ${result.message}`)
        failed.push(id)
        continue
      }
      // 頭像只是附帶的，下載失敗或不是 PNG 就不要
      const icon = path.join(work, 'icon.png')
      let hasIcon = false
      try {
        await fetchTo(`${BASE}/public/models/${id}/icon.png`, icon)
        hasIcon = (await readFile(icon)).subarray(0, 8).equals(PNG_MAGIC)
      } catch {
        hasIcon = false
      }
      await mkdir(target, { recursive: true })
      await move(glb, path.join(target, 'model.glb'))
      if (hasIcon) await move(icon, path.join(target, 'icon.png'))
      ok++
      console.log(`#${id} ${result.message}`)
    }

    console.log(`完成：新下載 ${ok} 隻、已經有 ${skipped} 隻、失敗 ${failed.length} 隻${failed.length ? `（${failed.join(' ')}）` : ''}`)
    console.log(`模型資料夾：${DEST}`)
    return failed.length === 0 ? 0 : 1
  } finally {
    if (existsSync(tmp)) await rm(tmp, { recursive: true, force: true })
  }
}

process.exitCode = await main()
