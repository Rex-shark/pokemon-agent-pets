// 找一個真的能跑的 Python 3（Codex 轉接器 hooks/codex-hook.py 與它的測試用）。
//
// Windows 的 python3／python 常常是 WindowsApps 裡的假捷徑：沒裝 Python 時會打開 Microsoft Store、exit 9009 或 49，
// 所以不能只看指令存不存在，要真的跑一次確認是 3 版。順序：環境變數 PET_PYTHON → 平台常見的名字。
import { spawnSync } from 'node:child_process'

/** @returns {{ command: string, args: string[] } | null} 例如 { command: 'py', args: ['-3'] } */
export function findPython() {
  const candidates = []
  if (process.env.PET_PYTHON) candidates.push([process.env.PET_PYTHON])
  if (process.platform === 'win32') candidates.push(['py', '-3'], ['python'], ['python3'])
  else candidates.push(['python3'], ['python'])
  for (const [command, ...args] of candidates) {
    const probe = spawnSync(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)'], {
      stdio: 'ignore',
      timeout: 10_000,
    })
    if (probe.status === 0) return { command, args }
  }
  return null
}
