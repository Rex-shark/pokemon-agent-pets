#!/usr/bin/env node
// Claude Code hook（跨平台版，2026-11-13 為 Windows 加的；macOS 也能用）：把 stdin 的事件 JSON 原封不動轉給桌寵（electron/hook-server.ts）。
// 跟 pet-hook.sh 一樣的規則（參考 claude-office 與 pixel-agents）：永遠不輸出任何東西、永遠 exit 0、最多等 1 秒，
// 桌寵沒開時連線會立刻被拒，不會拖慢 Claude。只需要 Node，不需要 curl 或 bash。
//
// 設定（~/.claude/settings.json）：  "command": "node \"D:/path/to/pokemon-agent-pets/hooks/pet-hook.mjs\""
import http from 'node:http'

const PORT = Number(process.env.PET_HOOK_PORT) || 47821
const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 1000

const done = () => process.exit(0)
// 不管發生什麼都在時限內結束
setTimeout(done, TIMEOUT_MS + 200).unref()

const chunks = []
let size = 0
process.stdin.on('data', (chunk) => {
  size += chunk.length
  if (size <= MAX_BYTES) chunks.push(chunk)
})
process.stdin.on('error', done)
process.stdin.on('end', () => {
  if (size > MAX_BYTES) return done()
  const body = Buffer.concat(chunks)
  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: '/hook',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      timeout: TIMEOUT_MS,
    },
    (res) => {
      res.resume()
      res.on('end', done)
    },
  )
  req.on('timeout', () => req.destroy())
  req.on('error', done)
  req.end(body)
})
