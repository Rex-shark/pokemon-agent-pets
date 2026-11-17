import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { parseHookEvent, startHookServer } from '../electron/hook-server'
import { RanchState } from '../electron/ranch-state'
import { APP_DATA_DIR } from '../electron/species'
import type { RanchUpdate } from '../shared/ranch-protocol'

test('舊 Claude 事件、Codex 來源驗證與標題清理', () => {
  const event = { session_id: 'same-id', hook_event_name: 'SessionStart' }
  assert.equal(parseHookEvent(JSON.stringify(event))?.provider, 'claude')
  assert.equal(parseHookEvent(JSON.stringify({ ...event, provider: 'unknown' })), null)
  assert.equal(parseHookEvent(JSON.stringify({ ...event, session_id: '' })), null)
  const codex = parseHookEvent(JSON.stringify({ ...event, provider: 'codex', session_title: '  測試\n專案 ', transcript_path: '/private' }))!
  assert.equal(codex.session_title, '測試 專案')
  assert.equal(codex.transcript_path, undefined)
})

test('泡泡說明只留檔名與程式名稱：macOS 與 Windows 路徑都一樣', () => {
  const detail = (tool_name: string, tool_input: unknown) =>
    parseHookEvent(JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name, tool_input }))?.detail
  assert.equal(detail('Read', { file_path: '/Users/me/secret-project/src/main.ts' }), 'main.ts')
  assert.equal(detail('Edit', { file_path: 'C:\\Users\\me\\secret-project\\src\\main.ts' }), 'main.ts')
  assert.equal(detail('Write', { file_path: 'D:/work/secret/notes.md' }), 'notes.md')
  assert.equal(detail('Bash', { command: 'cd x && FOO=1 /usr/bin/git log -5' }), 'git log')
  assert.equal(detail('Bash', { command: 'C:\\Git\\cmd\\git.exe status' }), 'git status')
  assert.equal(detail('Bash', { command: '"C:\\Tools\\npm.cmd" run build' }), 'npm run')
})

test('同名 session、子代理、狀態轉換、舊存檔與重載', async () => {
  await mkdir(APP_DATA_DIR, { recursive: true })
  const file = path.join(APP_DATA_DIR, 'ranch.json')
  await writeFile(file, JSON.stringify({ version: 1, pets: [{ sessionId: 'same-id', speciesId: '025', adoptedAt: 1, lastEventAt: 1 }] }))
  let metaCalls = 0
  const ranch = new RanchState(() => {}, async () => { metaCalls++; return { title: null, group: null } })
  const codex = { provider: 'codex' as const, session_id: 'same-id', cwd: '/work/project' }
  try {
    await ranch.load()
    ranch.setSpecies(['025', '133'])
    assert.equal(ranch.list()[0].provider, 'claude')
    ranch.handle({ ...codex, hook_event_name: 'UserPromptSubmit', session_title: 'Codex 測試' })
    assert.equal(ranch.list().length, 2)
    const pet = () => ranch.list().find(p => p.provider === 'codex')!
    assert.equal(pet().sessionId, 'codex:same-id')
    assert.equal(pet().speciesId, '133')
    assert.equal(pet().title, 'Codex 測試')
    assert.equal(pet().mode, 'busy')
    ranch.handle({ ...codex, hook_event_name: 'SubagentStart', agent_id: 'child' })
    assert.equal(ranch.list().length, 2)
    assert.equal(pet().mode, 'busy')
    ranch.handle({ ...codex, hook_event_name: 'PermissionRequest', agent_id: 'child', tool_name: 'Bash' })
    assert.equal(pet().mode, 'waiting')
    ranch.handle({ ...codex, hook_event_name: 'PostToolUse' })
    assert.equal(pet().mode, 'busy')
    ranch.handle({ ...codex, hook_event_name: 'PreCompact' })
    assert.equal(pet().mode, 'compacting')
    ranch.handle({ ...codex, hook_event_name: 'PostCompact' })
    assert.equal(pet().mode, 'busy')
    ranch.handle({ ...codex, hook_event_name: 'PostToolUseFailure' })
    assert.equal(pet().mode, 'error')
    ranch.handle({ ...codex, hook_event_name: 'Interrupt' })
    assert.equal(pet().mode, 'idle')
    ranch.handle({ ...codex, hook_event_name: 'SessionEnd' })
    assert.equal(pet().active, false)
    ranch.handle({ ...codex, session_id: 'unknown', hook_event_name: 'SessionEnd' })
    assert.equal(ranch.list().length, 2)
    assert.equal(metaCalls, 0, 'Codex 不應讀 Claude 的 transcript')
  } finally {
    await ranch.dispose()
  }
  const saved = JSON.parse(await readFile(file, 'utf8')) as { pets: { provider: string; sessionId: string }[] }
  assert.equal(saved.pets.find(p => p.provider === 'codex')?.sessionId, 'codex:same-id')
  const restored = new RanchState(() => {}, async () => ({ title: null, group: null }))
  try {
    await restored.load()
    restored.handle({ ...codex, hook_event_name: 'SessionStart' })
    assert.equal(restored.list().length, 2, '重開不重複認養')
    restored.release('codex:same-id')
    assert.equal(restored.list().length, 1)
    assert.equal(restored.list()[0].provider, 'claude')
    restored.handle({ ...codex, hook_event_name: 'SessionStart' })
    assert.equal(restored.releaseAll(), 2)
    assert.equal(restored.list().length, 0)
    assert.equal(restored.releaseAll(), 0, '空牧場再按一次不出錯')
    restored.handle({ ...codex, hook_event_name: 'UserPromptSubmit' })
    assert.equal(restored.list().length, 1, '全部放生後，還在線上的 session 照常重新認養')
    restored.releaseAll()
  } finally {
    await restored.dispose()
  }
  const cleared = JSON.parse(await readFile(file, 'utf8')) as { pets: unknown[] }
  assert.equal(cleared.pets.length, 0, '全部放生有寫進存檔')
})

test('Python hook 經 HTTP 到狀態機；完成提示與中斷分開處理', async () => {
  const updates: RanchUpdate[] = []
  const ranch = new RanchState(update => updates.push(update), async () => ({ title: null, group: null }))
  const server = startHookServer(event => ranch.handle(event), 0)
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}/hook`
  async function emit(name: string) {
    // scripts/test-hooks.mjs 找好的 Python（Windows 是 py -3 或 python）
    const [python, ...pythonArgs] = JSON.parse(process.env.PET_TEST_PYTHON ?? '["python3"]') as string[]
    const child = spawn(python, [...pythonArgs, '-I', path.join(process.env.PET_TEST_ROOT!, '../hooks/codex-hook.py'), '--port', String(port)])
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    const closed = once(child, 'close')
    child.stdin.end(JSON.stringify({ session_id: 'end-to-end', hook_event_name: name, cwd: '/work/demo' }))
    assert.equal((await closed)[0], 0)
    assert.equal(stdout, '{}\n')
    assert.equal(stderr, '')
  }
  try {
    await emit('UserPromptSubmit')
    assert.equal(ranch.list()[0].mode, 'busy')
    await emit('Stop')
    assert.equal(updates.at(-1)?.cue?.kind, 'done')
    await emit('UserPromptSubmit')
    await emit('Interrupt')
    assert.equal(updates.at(-1)?.cue, null)
    assert.equal(ranch.list()[0].mode, 'idle')
    const rejected = await fetch(url, { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' })
    assert.equal(rejected.status, 404)
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 400)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await ranch.dispose()
  }
})
