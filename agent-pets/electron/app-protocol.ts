/**
 * 兩個自訂協定，都由主行程從磁碟讀檔、照副檔名給 Content-Type（照抄 live2d-fantastic-days）：
 *
 * - app://pet/ → 打包後的 renderer（dist/）。不用 loadFile（file://）：file:// 底下 fetch 不能用。
 * - petmodels://local/ → 模型資料夾（專案裡的 models/，species.ts 的 MODELS_DIR）。開發時頁面是 http://localhost:5173，
 *   跨來源，所以回應要帶 Access-Control-Allow-Origin。
 */
import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { isInside } from './platform'
import { MODEL_SCHEME } from './species'

const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://pet`

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
}

/** 一定要在 app ready 之前呼叫，而且兩個協定要在同一次呼叫裡註冊（Electron 的限制） */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: MODEL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

/** URL 路徑對應到 root 底下的檔案；跑出 root 的路徑一律 404 */
function serveDirectory(scheme: string, rootDir: string, extraHeaders: Record<string, string> = {}): void {
  // root 也要正規化：PET_MODELS_DIR 在 Windows 可能寫成 D:/x/models，join 出來的檔案路徑卻是反斜線
  const root = path.resolve(rootDir)
  protocol.handle(scheme, async (request) => {
    const file = path.normalize(path.join(root, decodeURIComponent(new URL(request.url).pathname)))
    if (!isInside(root, file)) return new Response(null, { status: 404, headers: extraHeaders })
    try {
      const body = await readFile(file)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
        headers: { 'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream', ...extraHeaders },
      })
    } catch {
      return new Response(null, { status: 404, headers: extraHeaders })
    }
  })
}

/** app ready 之後呼叫；只有打包後才需要 */
export function serveAppScheme(root: string): void {
  serveDirectory(APP_SCHEME, root)
}

/** app ready 之後呼叫；開發、打包都要 */
export function serveModelScheme(modelsDir: string): void {
  serveDirectory(MODEL_SCHEME, modelsDir, { 'Access-Control-Allow-Origin': '*' })
}
