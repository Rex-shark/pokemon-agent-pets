# 安裝與啟動

這份是完整的步驟，每一步都有「確認」。可以自己照著做，也可以把這個 repo 交給你的 AI agent（Claude Code、Codex…），請它照這份一步一步做。

裝好之後，使用者問「泡泡顏色是什麼意思」「怎麼拿掉一隻」這類問題，請讀 [features.md](features.md)：那份寫給 agent，講裝好之後看到的東西與怎麼用。

## 通則

- 除非另外註明，所有指令都在 **`agent-pets/`** 底下執行（repo 根目錄只有文件和 `hooks/`）。
- 每一步都有「確認」，確認通過再往下做。
- 🔴 有三件事要**先問過使用者**才能做：下載模型（第 2 步）、改 `~/.claude/settings.json` 或 `~/.codex/hooks.json`（第 3 步）、結束占用 port 的其他程式（第 4 步）。
- 支援 **macOS** 與 **Windows**。兩邊共用同一份程式、地圖與模型，差異收在 `agent-pets/electron/platform/`。指令一樣的地方只寫一次；不一樣的地方分「macOS」「Windows」兩段。Windows 的指令是 PowerShell。

| | macOS | Windows |
|------|------|------|
| 控制選單 | Dock 圖示按右鍵 | 系統匣（右下角）的精靈球圖示，左鍵或右鍵 |
| 顯示模式 | 置頂小牧場、桌布模式 | 只有置頂小牧場（沒有桌布模式） |
| 存檔位置 | `~/Library/Application Support/Pokemon Ranch Pets/` | `%APPDATA%\Pokemon Ranch Pets\` |
| Claude Code hook | `hooks/pet-hook.mjs`（或舊的 `pet-hook.sh`） | `hooks/pet-hook.mjs` |
| 打包 | `npm run dist:mac` | `npm run dist:win` |

### 0. 確認環境

| 需要 | 確認方式 |
|------|------|
| macOS（在 Apple Silicon 上開發與測試）或 Windows 10／11 | — |
| Node.js 22.12 以上、npm | `node -v` |
| Python 3（**只有 Codex 的 hook 與 `npm test` 需要**；下載模型、Claude Code 的 hook 都不用） | macOS：`python3 --version`；Windows：`py -3 --version` 或 `python --version` |
| [Claude Code](https://claude.com/claude-code) | 使用者已經在用 |

🔴 Windows 上的 `python3`／`python` 常常是 WindowsApps 裡的假捷徑（沒裝 Python 時會打開 Microsoft Store）。用上面的指令確認印得出版本號。

### 1. 安裝套件

```bash
cd agent-pets
```

```bash
npm install
```

**確認**：下面這行印出 Electron 的版本（`v45.0.0`）。

```bash
npx electron --version
```

印不出來代表 npm 擋了 install script、Electron 本體沒有下載，手動補一次再確認：

```bash
node node_modules/electron/install.js
```

### 2. 準備模型

模型要到原專案取得，放進 `agent-pets/models/`；資料夾擺對了，程式啟動時就會自動使用。macOS、Windows 用同一份模型。取得的方式有兩種，**用哪一種由使用者決定**：

- **自己抓**：照下面的來源和對照表，用你習慣的方式下載、擺好。
- **用 repo 附的參考腳本**：`scripts/fetch-models.mjs` 會照同一個來源逐檔下載並檢查，見「[選用：用附的參考腳本抓](#選用用附的參考腳本抓)」。

不管用哪一種，最後都要跑一次「確認」。

🔴 **先問使用者再下載。** 原專案的程式碼是 MIT，但模型不是：原專案寫明角色與素材屬於各自的權利方，不授予那些素材的權利。請使用者自己決定要不要取得，並且只在自己的電腦上用，不要放進 git、不要分享。

**來源**

| 項目 | 內容 |
|------|------|
| 原專案 | `github.com/06wj/pokemon`（🔴 原作者已關閉，2026-11 確認打不開） |
| 目前可用的來源 | 它的 fork：<https://github.com/Guardwu2015/pokemon/tree/00d96f7f18894055e7f1db44fa0df6462e5e4c8a> |
| 固定 commit | `00d96f7f18894055e7f1db44fa0df6462e5e4c8a` |
| 整包 ZIP | <https://github.com/Guardwu2015/pokemon/archive/00d96f7f18894055e7f1db44fa0df6462e5e4c8a.zip> |
| 單一檔案 | `https://raw.githubusercontent.com/Guardwu2015/pokemon/00d96f7f18894055e7f1db44fa0df6462e5e4c8a/<檔案路徑>` |
| 範圍 | 第一代 151 隻（`001`～`151`），全部約 450 MB |

🔴 一定要用這個 commit，而且網址裡一定要帶著它。原專案之後的版本會轉檔貼圖、修剪模型資料，檔案跟這裡驗證過的不一樣。

**為什麼改用 Guardwu2015/pokemon**

- 原作者把 `06wj/pokemon` 關掉了，原本的網址全部失效。
- GitHub 上同一個專案的 fork 共用同一份儲存，所以原作者推過的那個 commit 還留在 fork 網路裡，從任何一個還在的 fork 用 commit 編號都取得到。`Guardwu2015/pokemon` 是其中一個（2026-11 實際下載驗證過，151 隻的內容與原本的完全相同）。
- 🔴 不要用那個 fork 的 `master` 分支或首頁：那是 2018 年的舊版，只有 148 隻、沒有動作、格式也不同（`.gltf`＋`.bin`），這個專案不能用。
- 這個 commit 不在任何分支上，GitHub 之後可能清掉；那個 fork 也可能消失。網址打不開（404）時，告訴使用者來源已經失效，請他自己提供模型，不要改去抓別的版本或別的來源充數。
- `scripts/fetch-models.mjs` 裡的網址**還是舊的**（刻意沒改），直接跑會全部失敗；要用它的話先照腳本開頭的說明改一行，見下面「選用：用附的參考腳本抓」。

**要拿哪些檔案、放到哪裡**

| 原專案裡的位置 | 放到 | 少了會怎樣 |
|------|------|------|
| `src/content/animatedModels.json` | `agent-pets/models/animatedModels.json` | 🔴 程式找不到模型資料夾，畫面顯示「還沒有寶可夢模型」 |
| `public/models/<編號>/model.glb` | `agent-pets/models/<編號>/model.glb` | 那一隻不會出現 |
| `public/models/<編號>/icon.png` | `agent-pets/models/<編號>/icon.png` | 只有展示網站的清單沒有頭像，可以不拿 |

`<編號>` 是三位數的圖鑑編號（`001`、`025`、`151`）。不用 151 隻都拿，只放幾隻也能跑。

自己抓的話，方式由你決定（clone 後切到固定 commit、下載 ZIP、或逐檔抓都可以），但要守這幾條：

- **只複製上面三種資料檔**，不要執行原專案裡的任何程式，也不要在原專案裡跑 `npm install`。
- 下載到 repo 外面的暫存資料夾，檢查通過再放進 `agent-pets/models/`。
- 最後的資料夾要長這樣：

```
agent-pets/models/
├── animatedModels.json
├── 001/
│   ├── model.glb
│   └── icon.png
├── 002/…
└── 151/…
```

#### 選用：用附的參考腳本抓

repo 附了一支下載腳本當參考（Node 寫的，macOS、Windows 都能跑），使用者同意的話可以直接用，也可以只拿來看要抓哪些檔案、怎麼檢查。🔴 一樣要**先問過使用者**再執行。

🔴 **腳本裡的來源網址還指向已經關閉的 `06wj/pokemon`，照原樣跑會全部失敗。** 這是刻意保留的：請先打開 `scripts/fetch-models.mjs`，讀開頭那段說明，理解原因後自己把 `BASE` 那一行的帳號 `06wj` 換成 `Guardwu2015`（`COMMIT` 不要動），再先抓一隻確認（`node scripts/fetch-models.mjs 025`）。改完還是 404 就停下來告訴使用者，不要換別的版本或來源。

抓全部 151 隻（約 450 MB，要一段時間；可以中斷後重跑，已經有的會跳過）：

```bash
npm run setup:models
```

只抓幾隻（後面接三位數編號）：

```bash
node scripts/fetch-models.mjs 025 133
```

腳本做的事：

- 只用 Node 內建的 `fetch` 從上面那個固定 commit 抓 `animatedModels.json`、`model.glb`、`icon.png` 三種資料檔，不 clone、不執行原專案的任何程式。
- 每個 GLB 先下載到系統的暫存資料夾，用 `scripts/verify-model.mjs` 檢查通過才搬進去；`icon.png` 要是真的 PNG 才保留。
- 放到腳本所在專案的 `agent-pets/models/`，位置是從腳本自己的位置算出來的，repo 放在哪裡都一樣。要放別處用環境變數 `PET_MODELS_DIR` 指定，`npm run dev` 時也要帶同一個變數（打包好的 App 讀不到終端機的環境變數，建議用預設位置）。
- 結束時印出「新下載幾隻、已經有幾隻、失敗幾隻」。有失敗的重跑一次就好。

**確認**（都在 `agent-pets/` 底下執行，兩個平台一樣）

清單檔在，而且是 JSON 物件。印出的數字是清單裡的隻數（151）：

```bash
node -p "Object.keys(require('./models/animatedModels.json')).length"
```

每個 GLB 都通過檢查（glTF 2.0、檔案完整、貼圖與資料全部內嵌、沒有指向外部的網址、沒有不認得的擴充），並印出模型數量（全拿是 151）。有「不通過」的檔案就是壞的或來路不對，刪掉重拿：

```bash
node -e "const fs=require('fs');import('./scripts/verify-model.mjs').then(async m=>{let n=0;for(const d of fs.readdirSync('models')){const f='models/'+d+'/model.glb';if(!fs.existsSync(f))continue;n++;const r=await m.verifyModelFile(f);if(!r.ok)console.log(f,r.message)}console.log('模型數量',n)})"
```

模型沒有被 git 看到。這行**不會印出任何東西**才對（`agent-pets/.gitignore` 已經排除 `/models/` 和 `*.glb`）：

```bash
git status --porcelain -- models
```

### 3. 安裝 hooks

桌寵靠 hooks 知道每個 session 在做什麼。hook 檔在 repo 根目錄的 [`hooks/`](../hooks/)：

- **Claude Code**：把 `hooks/pet-hook.mjs` 加進**使用者層級**的 `~/.claude/settings.json`（Windows 是 `%USERPROFILE%\.claude\settings.json`），11 種事件。設定範例：
  - macOS：[`hooks/claude-settings.example.json`](../hooks/claude-settings.example.json)（用 `pet-hook.sh`；想改用 `pet-hook.mjs` 也可以，寫法同 Windows）
  - Windows：[`hooks/claude-settings.example.windows.json`](../hooks/claude-settings.example.windows.json)（`node "C:/path/to/pokemon-agent-pets/hooks/pet-hook.mjs"`）
- **Codex**：照 [Codex 接入說明](codex-hooks.md) 產生設定，合併進 `~/.codex/hooks.json`。

🔴 **先問使用者再改。** 這些是使用者的全域設定，改之前要得到同意，而且：

- **合併，不要覆蓋**：保留原本的其他設定和其他 hooks。
- **先看有沒有裝過**：已經有指向 `pet-hook.sh` 或 `pet-hook.mjs` 的項目就不要再加，事件會重複。
- **只裝使用者層級**：不要裝到個別專案的 `.claude/settings.json`，一樣會重複。
- `command` 要寫**絕對路徑**：把範例裡的 `/path/to/pokemon-agent-pets` 換成這個 repo 的絕對路徑。Windows 用正斜線（`D:/idea/…/hooks/pet-hook.mjs`）最不容易出錯，路徑外面加雙引號。

macOS 用 `pet-hook.sh` 的話，先確認腳本可以執行（印出的權限要有 `x`；沒有就 `chmod +x ../hooks/pet-hook.sh`）：

```bash
ls -l ../hooks/pet-hook.sh
```

hook 腳本不會影響 Claude：永遠不輸出、永遠 `exit 0`、最多等 1 秒。桌寵沒開時連線立刻被拒，Claude 照常工作。

**確認**：`~/.claude/settings.json` 還是合法的 JSON，而且 `pet-hook` 剛好出現 11 次（兩個平台一樣）：

```bash
node -e "const s=require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude','settings.json'),'utf8');JSON.parse(s);console.log('JSON 正常，pet-hook 出現',(s.match(/pet-hook\.(sh|mjs)/g)||[]).length,'次')"
```

新的 hooks 要**新開的 session** 才會生效，已經開著的 session 不會進牧場。

### 4. 啟動

hook 送到 `127.0.0.1:47821`，這個 port 一次只能給一個程式用。先確認沒有被占用（**不會印出任何東西**才對）：

macOS：

```bash
lsof -nP -iTCP:47821 -sTCP:LISTEN
```

Windows（PowerShell）：

```powershell
Get-NetTCPConnection -LocalPort 47821 -State Listen -ErrorAction SilentlyContinue
```

🔴 有東西占著的話，先告訴使用者是哪個程式，問過再處理，不要自己關掉別人的程式。

有兩種開法，擇一：

**開發模式**（會占住終端機，請在背景或另一個終端機跑）：

```bash
npm run dev
```

**打包成 App**（不簽章，只給自己這台用）：

macOS：

```bash
npm run dist:mac
```

Windows：

```bash
npm run dist:win
```

開／關打包好的 App（兩個平台一樣；47821 被別的程式占著時不會開）：

```bash
npm run app:open
```

```bash
npm run app:quit
```

App 的位置：macOS 是 `agent-pets/release/mac-arm64/Pokemon Ranch Pets.app`，Windows 是 `agent-pets/release/win-unpacked/Pokemon Ranch Pets.exe`。🔴 App 要留在 `release/` 裡開：它是從自己的位置往上找專案的 `models/`，搬到別處（例如「應用程式」或 `Program Files`）就找不到模型。

**確認**

hook 伺服器有在聽。送一個空的事件，應該印出 `400`（格式不對所以被拒絕，不會認養寵物）；印出 `000` 或連線錯誤代表沒有程式在聽：

```bash
node -e "fetch('http://127.0.0.1:47821/hook',{method:'POST',body:'{}'}).then(r=>console.log(r.status),()=>console.log('000'))"
```

然後請使用者看畫面：

- 主螢幕右下角出現一座小島（Windows 的系統匣也會多一個精靈球圖示，可能收在「^」裡面）。
- 畫面上沒有「還沒有寶可夢模型」的提示。有的話回到第 2 步，通常是少了 `animatedModels.json`。
- 新開一個 Claude Code session、送出一句話，就會有一隻寶可夢來認養。

### 常見問題

| 狀況 | 原因與處理 |
|------|------|
| 顯示「還沒有寶可夢模型」 | `agent-pets/models/animatedModels.json` 不在，或 `models/` 裡沒有 `<編號>/model.glb`。回到第 2 步的確認。放好之後要**重新啟動**（模型資料夾的位置是啟動時決定的）；之後只是增減幾隻，用選單（Dock／系統匣）「重新掃描模型」就好。 |
| 牧場空空的，開了 session 也沒有寵物 | hooks 沒裝好，或那個 session 是在裝 hooks 之前開的。照第 3 步的確認檢查，再新開一個 session。 |
| 有小島但收不到事件 | 47821 被別的程式占用（例如同時開了打包好的 App 和 `npm run dev`），後開的那個收不到。 |
| 同一個動作泡泡跳兩次 | hooks 裝了兩份（使用者層級和專案層級都有，或 `pet-hook.sh` 與 `pet-hook.mjs` 都裝了）。只留使用者層級的一份。 |
| 某一隻沒出現 | 那一隻的 `model.glb` 壞了，跑第 2 步的檢查指令。 |
| Windows 找不到選單 | 選單在系統匣的精靈球圖示上；圖示可能收在工作列右下角的「^」裡，可以拖到工作列上常駐。 |
| Windows 沒有「桌布模式」 | Windows 版不做桌布模式，只有置頂小牧場。 |
| 小牧場擋到別的視窗 | 選單取消勾選「置頂」，它就變成一般視窗、會被其他視窗蓋住；要看時再勾回來，會拉到最前面。 |
| Windows 的 `npm test` 說找不到 Python | 裝 Python 3（python.org 的安裝程式會附 `py`），或用環境變數 `PET_PYTHON` 指定 python.exe 的完整路徑。 |

## 裝好之後

全部確認通過後，跟使用者簡單說明怎麼看泡泡顏色、選單在哪裡、怎麼放生。內容與使用者常問的問題在 [features.md](features.md)。
