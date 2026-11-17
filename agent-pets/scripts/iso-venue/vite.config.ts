/**
 * 等角場地預覽（2026-11-12）：只有場地、沒有寵物的獨立網頁，看等角透視下不同場地配置的效果。
 *
 * 用法（在 agent-pets/ 底下）：
 *   ISO_WALLPAPER=桌布截圖.png npx vite --config scripts/iso-venue/vite.config.ts
 *   瀏覽器開 http://127.0.0.1:5191/
 * ISO_WALLPAPER 可省略（省略就用純色背景）。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

function wallpaper(): Plugin {
  return {
    name: 'iso-venue-wallpaper',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== '/wallpaper.png' || !process.env.ISO_WALLPAPER) return next()
        try {
          const png = await readFile(process.env.ISO_WALLPAPER)
          res.setHeader('Content-Type', 'image/png')
          res.end(png)
        } catch {
          // 檔案不在就當沒有桌布（頁面會用漸層背景）
          res.statusCode = 404
          res.end()
        }
      })
    },
  }
}

export default defineConfig({
  root: here,
  server: { host: '127.0.0.1', port: 5191, strictPort: true },
  plugins: [wallpaper()],
})
