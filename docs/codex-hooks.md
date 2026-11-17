# Codex 接入牧場

Codex 與 Claude 共用同一座牧場及 `POST http://127.0.0.1:47821/hook`。Codex 原生事件經 `hooks/codex-hook.py` 轉換後才送出；不需要 API key、不讀對話紀錄、不額外啟動 Codex session。

依據：[OpenAI 官方 Hooks 文件](https://learn.chatgpt.com/docs/hooks)。本機確認的 CLI 版本是 `0.167.0-alpha.3.2`。需使用支援原生 hooks 的 Codex 版本；本次完成的是轉接器與 HTTP／狀態機整合測試，尚未在使用者的 Desktop 啟用實測。

## 原專案新增的參數

| 參數 | 放哪裡 | 用途 |
|------|------|------|
| `provider` | `/hook` 的 JSON | `claude` 或 `codex`；省略時仍是 Claude。Codex 腳本自動補上。 |
| `session_id` | `/hook` 的 JSON（原本就有） | 原始 Codex session ID，同一個聊天持續使用同一個值；不要每回合重建。牧場內部自動加 `codex:` 前綴。 |
| `session_title` | `/hook` 的 JSON | 選填顯示名稱，限制 80 字；省略時使用 `cwd` 的最後一層名稱。 |
| `cwd` | `/hook` 的 JSON（原本就有） | 工作目錄，Codex hook 原生會提供。 |
| `agent_id` | `/hook` 的 JSON（原本就有） | 子代理事件；搭配父 session ID，只更新父寵物。 |
| `PET_HOOK_PORT` | App／腳本環境變數 | 原本就有，預設 `47821`。兩端必須相同。 |
| `PET_DATA_DIR` | App 環境變數 | 新增。隔離 `ranch.json`、`settings.json`、`window.json`，測試不會寫到正式存檔。未指定時沿用原位置。 |

`provider` 會保存到 `ranch.json` 並傳到 renderer。舊存檔沒有此欄位時視為 Claude，原認養關係不變；Codex 名牌與選單項目會標示來源。`provider` 是來源標記，不是身分驗證。

範例：

```json
{
  "provider": "codex",
  "session_id": "thread-example",
  "hook_event_name": "PreToolUse",
  "cwd": "/work/my-project",
  "session_title": "後端整理",
  "tool_name": "Bash",
  "tool_input": { "description": "執行型別檢查" }
}
```

不用額外傳 `model`、`turn_id`、提示或對話內容：目前寵物以 session 為單位，狀態機不需要那些欄位。

## 產生安裝設定

在 repo 根目錄執行（Python 3.9 以上，無額外套件）：

```bash
python3 -I hooks/codex-hook.py --print-config
```

Windows 的 `python3` 常是 Microsoft Store 的假捷徑，改用 `py -3`（或真的 `python.exe` 的完整路徑）：

```powershell
py -3 -I hooks/codex-hook.py --print-config
```

Windows 產生的 `command` 用雙引號（`subprocess.list2cmdline`），macOS／Linux 用 POSIX shell quoting。Windows 上的 Codex hook 還沒有實測。

這只輸出 JSON，不修改設定。產生內容包含目前 Python 與腳本的絕對路徑、12 種事件及 3 秒 hook timeout。腳本的 HTTP timeout 是 1 秒。原生 hook 模式只輸出 `{}` 並成功結束，即使牧場未開也不改變 Codex 的權限決策或回合流程。

腳本選項：

| 選項 | 用途 |
|------|------|
| `--port 47899` | 指定 port；優先於 `PET_HOOK_PORT`。產生設定時會將 port 固定寫進 command，避免 Desktop 沒繼承 shell 環境。 |
| `--title '後端整理'` | 明確指定顯示名稱；也可用 `PET_SESSION_TITLE`。未指定就顯示專案目錄名稱，不會擷取提示當標題。 |
| `--print-config` | 輸出 hooks 設定。全域固定 `--title` 會套用所有聊天，通常省略即可。 |
| `--dry-run` | 從 stdin 讀事件，只顯示過濾後結果，不連線、不認養。 |

使用者要求安裝時，再將輸出**合併**到使用者層級 `~/.codex/hooks.json`（若設了 `CODEX_HOME`，使用其對應目錄），保留其他 hooks。先檢查 inline TOML、專案及外掛是否已有相同腳本，避免重複安裝；不要整份覆蓋或同時裝到全域與專案。

之後在 Codex CLI 的 `/hooks`，或 Desktop 的 Settings → Hooks，檢視並信任設定。這是 Codex 原生的 hooks 信任機制；未信任的 hooks 不會執行。不要略過信任檢查。安裝後新開聊天，確認 `SessionStart`／`UserPromptSubmit` 能進牧場。

**必須先使用包含此次修改的牧場程式。** 舊的打包 App 不認得 `provider`，不能直接啟用這支腳本送給舊版。要更新正式 App，等使用者要求重新打包／重啟時再做。

## 事件差異

| Codex 事件／工具 | 牧場處理 |
|------|------|
| `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`Stop`、`SessionEnd` | 沿用現有狀態機 |
| `SubagentStart`、`SubagentStop` | 沿用父 session 的寵物 |
| `PreCompact` → `PostCompact` | 整理記憶 → 思考中 |
| `SessionStart` 且 `source=compact` | 視為 `PostCompact`，不誤顯示待機 |
| `Interrupt` | 回待機，不播放完成音效 |
| `exec_command`／`shell_command`／`shell` | 轉成 `Bash`，只保留簡短 description |
| `apply_patch` | 轉成 `Edit`，不傳送 patch |
| `request_user_input` | 轉成 `AskUserQuestion`，只保留 header |
| `spawn_agent` | 轉成 `Agent`，不傳送派工內容 |
| `PostToolUse` 回傳物件有非零整數 `exit_code` 或 `isError=true` | 轉成牧場的 `PostToolUseFailure` |

不替 Codex 設定 `PostToolUseFailure` hook：它不是目前官方列出的 Codex 事件。工具回應若只有自由文字，無法可靠判斷是否失敗，會維持一般 `PostToolUse`；工具 hooks 也不是所有託管工具都會觸發。這些情況仍會靠 `Stop` 或閒置逾時更新狀態。

## 驗證

```bash
npm test
npx tsc --noEmit
```

測試使用暫存資料夾與 OS 分配的 loopback port，驗證過濾、事件轉換、Claude 相容性、存檔重載及 Python → HTTP → 狀態機。只會修改測試自己的檔案。

只看轉換結果：

```bash
python3 -I hooks/codex-hook.py --dry-run <<'JSON'
{"session_id":"demo","hook_event_name":"PreToolUse","cwd":"/work/demo","tool_name":"apply_patch","tool_input":{"command":"不應轉送的 patch"}}
JSON
```

需要實際看畫面時，在獨立終端機啟動隔離牧場：

```bash
PET_DATA_DIR="$(mktemp -d /tmp/pokemon-codex-demo.XXXXXX)" PET_HOOK_PORT=47899 npm run dev
```

再送假事件（此步會在隔離牧場認養寵物）：

```bash
python3 -I hooks/codex-hook.py --port 47899 --title 'Codex 測試' <<'JSON'
{"session_id":"codex-demo","hook_event_name":"UserPromptSubmit","cwd":"/work/demo"}
JSON
```

驗證完成只關閉這次自己啟動的程序；正式 App 與其存檔不受影響。
