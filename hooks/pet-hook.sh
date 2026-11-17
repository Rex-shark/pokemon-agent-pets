#!/bin/sh
# Claude Code hook：把 stdin 的事件 JSON 原封不動轉給桌寵（electron/hook-server.ts）。
# 規則（參考 claude-office 與 pixel-agents）：永遠不輸出任何東西、永遠 exit 0、最多等 1 秒，
# 桌寵沒開時連線會立刻被拒，不會拖慢 Claude。
curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- \
  "http://127.0.0.1:${PET_HOOK_PORT:-47821}/hook" >/dev/null 2>&1
exit 0
