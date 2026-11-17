// 啟動／結束打包好的 App（npm run app:open／app:quit；IDEA 執行組態「寶可夢牧場 啟動 App」「寶可夢牧場 結束 App」用）。
// 2026-11-13 從 pet-app.sh（zsh＋lsof＋osascript）改寫成 Node：macOS、Windows 用同一支。
//
//   node scripts/pet-app.mjs open   開 release/ 裡打包好的 App；47821 被別的桌寵占著時不開（開了也收不到 hooks）
//   node scripts/pet-app.mjs quit   結束 App（正常結束，會先存檔）
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_NAME = 'Pokemon Ranch Pets'
/** electron-builder.yml 的 appId */
const BUNDLE_ID = 'io.github.rex-shark.pokemon-ranch-pets'
const PORT = Number(process.env.PET_HOOK_PORT) || 47821
const IS_WIN = process.platform === 'win32'

/** 打包輸出的位置（electron-builder 的 dir 目標）；平台各一個 */
const APP_PATH = {
  darwin: path.join(ROOT, 'release', 'mac-arm64', `${APP_NAME}.app`),
  win32: path.join(ROOT, 'release', 'win-unpacked', `${APP_NAME}.exe`),
}[process.platform]

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  return result.status === 0 ? result.stdout : ''
}

/** 在 PORT 上 LISTEN 的程式的 pid（找不到回 null） */
function listenerPid() {
  if (IS_WIN) {
    // 「  TCP    127.0.0.1:47821    0.0.0.0:0    LISTENING    1234」
    for (const line of run('netstat', ['-ano', '-p', 'TCP']).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      if (cols[0] === 'TCP' && cols[1]?.endsWith(`:${PORT}`) && cols[3] === 'LISTENING') return Number(cols[4])
    }
    return null
  }
  const pid = run('lsof', [`-tiTCP:${PORT}`, '-sTCP:LISTEN']).split('\n')[0]?.trim()
  return pid ? Number(pid) : null
}

/** pid 對應的程式名稱 */
function programName(pid) {
  if (IS_WIN) {
    // 「"Pokemon Ranch Pets.exe","1234","Console","1","123,456 K"」
    const line = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).trim()
    return line.startsWith('"') ? line.split('","')[0].slice(1) : ''
  }
  return run('ps', ['-o', 'comm=', '-p', String(pid)]).trim()
}

function open() {
  if (!APP_PATH) {
    console.log(`這個平台（${process.platform}）沒有打包設定`)
    return 1
  }
  if (!existsSync(APP_PATH)) {
    console.log(`還沒打包：先執行「寶可夢牧場 打包」（npm run ${IS_WIN ? 'dist:win' : 'dist:mac'}）`)
    return 1
  }
  const pid = listenerPid()
  if (pid) {
    const program = programName(pid)
    if (program.includes(APP_NAME)) {
      console.log(`已經開著了（pid ${pid}）`)
      return 0
    }
    console.log(`${PORT} 被 ${path.basename(program) || '別的程式'}（pid ${pid}）占用：別的桌寵或 npm run dev 開著，先關掉再啟動`)
    return 1
  }
  if (IS_WIN) {
    spawn(APP_PATH, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  } else {
    spawnSync('open', [APP_PATH], { stdio: 'inherit' })
  }
  console.log(`已啟動：${APP_PATH}`)
  return 0
}

function quit() {
  if (IS_WIN) {
    // 用 hook port 找主行程（App 有好幾個同名的子行程）；不加 /F：送關閉訊息，App 會先存檔再結束
    const pid = listenerPid()
    if (!pid || !programName(pid).includes(APP_NAME)) {
      console.log('沒有在跑')
      return 0
    }
    const result = spawnSync('taskkill', ['/PID', String(pid)], { encoding: 'utf8', windowsHide: true })
    console.log(result.status === 0 ? '已結束' : `結束失敗：${(result.stderr || result.stdout).trim()}`)
    return result.status === 0 ? 0 : 1
  }
  // macOS：用 bundle id 指定；先確認有在跑，對沒開的 App 送 quit 會先把它打開
  if (spawnSync('pgrep', ['-xq', APP_NAME]).status !== 0) {
    console.log('沒有在跑')
    return 0
  }
  const result = spawnSync('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`], { stdio: 'inherit' })
  if (result.status === 0) console.log('已結束')
  return result.status ?? 1
}

const command = process.argv[2]
if (command === 'open') process.exitCode = open()
else if (command === 'quit') process.exitCode = quit()
else {
  console.log('用法：node scripts/pet-app.mjs open|quit')
  process.exitCode = 1
}
