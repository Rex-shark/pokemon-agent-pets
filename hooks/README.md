# hooks

寶可夢牧場靠 hook 知道每個 session 在做什麼。這個資料夾放的是要裝到 Claude Code／Codex 的 hook，跟桌寵本體分開，可以單獨下載。

| 檔案 | 給誰用 | 平台 | 做什麼 |
|------|------|------|------|
| [pet-hook.mjs](pet-hook.mjs) | Claude Code | macOS、Windows | 把 stdin 的事件 JSON 原封不動 POST 給桌寵；只需要 Node |
| [pet-hook.sh](pet-hook.sh) | Claude Code | macOS | 同上，用 `curl`（原本的版本，macOS 已經裝好的可以繼續用） |
| [codex-hook.py](codex-hook.py) | Codex | macOS、Windows | 過濾、轉換 Codex 原生事件後 POST 給桌寵；只用 Python 標準函式庫 |
| [claude-settings.example.json](claude-settings.example.json) | Claude Code | macOS | 要合併進 `~/.claude/settings.json` 的 hooks 設定範例（11 種事件，用 `pet-hook.sh`） |
| [claude-settings.example.windows.json](claude-settings.example.windows.json) | Claude Code | Windows | 同上，用 `node "…/pet-hook.mjs"` |

所有 hook 都送到 `http://127.0.0.1:47821/hook`（環境變數 `PET_HOOK_PORT` 可以換 port，桌寵那邊要設一樣的值）。

## 不會影響 agent

- 永遠成功結束，最多等 1 秒。Claude Code 的 hook 不輸出任何東西；`codex-hook.py` 只回一個空的 `{}`（Codex 要求回 JSON），不影響權限、不加提示。
- 桌寵沒開時連線立刻被拒，agent 照常工作。
- 只連 `127.0.0.1`，不會把事件送到別的機器。

## Claude Code

把設定範例的 `hooks` **合併**進使用者層級的 `~/.claude/settings.json`（Windows 是 `%USERPROFILE%\.claude\settings.json`），`/path/to/pokemon-agent-pets` 換成這個 repo 的絕對路徑：

- **Windows**：用 [claude-settings.example.windows.json](claude-settings.example.windows.json)。路徑用正斜線、外面加雙引號，例如 `node "D:/idea/IdeaProjects/pokemon-agent-pets/hooks/pet-hook.mjs"`。
- **macOS**：用 [claude-settings.example.json](claude-settings.example.json)（`pet-hook.sh`），先確認腳本可以執行：

  ```bash
  chmod +x hooks/pet-hook.sh
  ```

  也可以跟 Windows 一樣改用 `node ".../pet-hook.mjs"`，兩支擇一，不要兩支都裝。

注意：

- **合併，不要覆蓋**：保留原本的其他設定和其他 hooks。
- **只裝使用者層級**：不要再裝到個別專案的 `.claude/settings.json`，事件會重複，泡泡會跳兩次。
- 已經有指向 `pet-hook.sh` 或 `pet-hook.mjs` 的項目就不要再加。
- 新的 hooks 要**新開的 session** 才會生效。

確認設定還是合法的 JSON，而且 `pet-hook` 剛好出現 11 次（兩個平台一樣）：

```bash
node -e "const s=require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude','settings.json'),'utf8');JSON.parse(s);console.log('JSON 正常，pet-hook 出現',(s.match(/pet-hook\.(sh|mjs)/g)||[]).length,'次')"
```

## Codex

在 repo 根目錄執行，會印出可以合併進 `~/.codex/hooks.json` 的設定（只輸出，不會修改任何檔案）。Windows 的 `python3` 常是 Microsoft Store 的假捷徑，改用 `py -3`：

```bash
python3 -I hooks/codex-hook.py --print-config
```

```powershell
py -3 -I hooks/codex-hook.py --print-config
```

產生的 `command` 會寫進目前 Python 與腳本的絕對路徑（Windows 用雙引號）。參數、事件對照與驗證方式見 [Codex 接入說明](../docs/codex-hooks.md)。

## 送出去的內容

- `pet-hook.mjs`、`pet-hook.sh` 不挑欄位，整包事件交給桌寵；桌寵只取用得到的欄位（session ID、事件名、工具名、工作目錄，以及檔名、指令的簡短描述這類看不出隱私的說明），其餘讀完就丟，不保存、不寫 log。檔名只取最後一段，Windows 的反斜線路徑也一樣。
- `codex-hook.py` 在送出前就先過濾：提示、回覆、patch、指令與工具輸出都不會離開 hook 這個程序。
