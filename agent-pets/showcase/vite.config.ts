/**
 * 展示網站（npm run showcase）：模組介紹＋151 隻的動作圖鑑。只在本機跑，不打包、不部署。
 *
 * 🔴 模型不進專案：角色權利屬於原權利方，只給本機自用。這裡用開發伺服器的 middleware
 * 直接讀模型資料夾（專案裡的 models/，electron/species.ts 的 MODELS_DIR），不複製、不建連結。
 *
 * - GET /api/species            → 有模型的品種（編號、繁中名稱、動作與長度）
 * - GET /models/<編號>/model.glb → 模型
 * - GET /models/<編號>/icon.png  → 頭像
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

import { MODELS_DIR, scanSpecies } from '../electron/species.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
/** 不要用 47821（桌寵的 hook port） */
const PORT = 5188

export interface ShowcaseAnimation {
  name: string
  /** 秒；清單裡沒有是 null */
  duration: number | null
}

export interface ShowcaseSpecies {
  id: string
  name: string
  modelUrl: string
  iconUrl: string
  animations: ShowcaseAnimation[]
}

type Manifest = Record<string, { animations?: { name?: unknown; duration?: unknown }[] }>

async function readManifest(): Promise<Manifest> {
  try {
    const data: unknown = JSON.parse(await readFile(path.join(MODELS_DIR, 'animatedModels.json'), 'utf8'))
    return typeof data === 'object' && data !== null ? (data as Manifest) : {}
  } catch {
    return {}
  }
}

async function listSpecies(): Promise<ShowcaseSpecies[]> {
  const [species, manifest] = await Promise.all([scanSpecies(), readManifest()])
  return species.map((s) => {
    const durations = new Map<string, number>()
    for (const a of manifest[s.id]?.animations ?? []) {
      if (typeof a.name === 'string' && typeof a.duration === 'number') durations.set(a.name, a.duration)
    }
    return {
      id: s.id,
      name: s.name,
      modelUrl: `/models/${s.id}/model.glb`,
      iconUrl: `/models/${s.id}/icon.png`,
      animations: s.animations.map((name) => ({ name, duration: durations.get(name) ?? null })),
    }
  })
}

const MODEL_FILE = /^\/models\/(\d{3})\/(model\.glb|icon\.png)$/
const CONTENT_TYPE: Record<string, string> = { 'model.glb': 'model/gltf-binary', 'icon.png': 'image/png' }

/** 只認得兩種網址：編號三位數字＋固定檔名，其他一律交給 Vite（不會讀到模型資料夾以外的檔案） */
function localModels(): Plugin {
  return {
    name: 'showcase-local-models',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        try {
          if (url === '/api/species') {
            const body = JSON.stringify({ modelsDir: MODELS_DIR, species: await listSpecies() })
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(body)
            return
          }
          const m = MODEL_FILE.exec(url)
          if (!m) return next()
          const file = path.join(MODELS_DIR, m[1], m[2])
          const info = await stat(file).catch(() => null)
          if (!info?.isFile()) {
            res.statusCode = 404
            res.end('not found')
            return
          }
          res.setHeader('Content-Type', CONTENT_TYPE[m[2]])
          res.setHeader('Content-Length', String(info.size))
          res.setHeader('Cache-Control', 'private, max-age=3600')
          createReadStream(file).pipe(res)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

export default defineConfig({
  root: here,
  // 介紹頁直接用牧場本體的程式（src/、shared/，唯讀引用），所以允許讀到上一層
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    fs: { allow: [path.resolve(here, '..')] },
  },
  // 只有開發伺服器：模型要靠上面的 middleware 讀，不做 build（也就不會有模型被打包出去）
  plugins: [localModels()],
})
