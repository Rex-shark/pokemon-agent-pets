// 把 TypeScript 測試建到暫存目錄；不碰 dist、Electron 或真正的存檔。
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'

import { findPython } from './lib/python.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), 'pokemon-hook-test-'))
try {
  // Windows 的 python3 常是 Microsoft Store 的假捷徑，要先找一個真的能跑的（scripts/lib/python.mjs）
  const py = findPython()
  if (!py) throw new Error('找不到 Python 3：Codex 轉接器測試需要它（可以用環境變數 PET_PYTHON 指定）')
  const python = spawnSync(py.command, [...py.args, '-I', '-B', path.join(root, 'tests/codex_hook_test.py')], { stdio: 'inherit' })
  if (python.status !== 0) throw new Error('Codex 轉接器測試失敗')
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: path.join(root, 'tests/hooks.test.ts'),
      outDir: path.join(temp, 'build'),
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'hooks.test.mjs' } },
    },
  })
  const result = spawnSync(process.execPath, ['--test', path.join(temp, 'build/hooks.test.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, PET_DATA_DIR: path.join(temp, 'data'), PET_MODELS_DIR: path.join(root, 'models'), PET_TEST_ROOT: root, PET_TEST_PYTHON: JSON.stringify([py.command, ...py.args]) },
  })
  process.exitCode = result.status ?? 1
} finally {
  await rm(temp, { recursive: true, force: true })
}
