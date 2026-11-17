# 寶可夢牧場：專案說明與結構

> 給之後接手的人（或 Claude session）看的總覽。功能清單、安裝步驟在 [agent-pets/README.md](../agent-pets/README.md)，這份講「程式怎麼分工、資料怎麼流」。

## 這是什麼

macOS／Windows 桌寵。桌面上有一座 3D 小牧場，**每個 Claude Code session 認養一隻第一代寶可夢**：

- 寵物在牧場裡自由走動，水系的在水裡游。
- agent 在做事時，寵物頭上出現雲朵泡泡，用顏色和音效提醒你：等你確認、出錯、做完了。
- 太久沒有動靜，寵物就睡著。
- 兩隻正面撞上，有機率打一架。

技術：Electron 45 ＋ Vite ＋ TypeScript ＋ three.js 0.187。3D 模型是 GLB，有骨骼動畫。場景全部用程式產生，沒有其他素材檔。

## 整體架構

```
Claude Code session（任何專案）
  │ hook 事件（~/.claude/settings.json，使用者層級，11 種事件）
  ▼
hooks/pet-hook.mjs ─── POST ────────▶ 127.0.0.1:47821/hook
                                          │
┌──────────── Electron 主行程（electron/） ─┼─────────────────────────┐
│ hook-server.ts   只聽本機、拒絕帶 Origin 的請求、只留安全的簡短說明 │
│        ▼                                                           │
│ ranch-state.ts   認養（ranch.json）＋每個主 agent 的狀態機          │
│        ▼  每個事件送一次完整快照 RanchUpdate                        │
│ main.ts          視窗（置頂／桌布）、選單、滑鼠穿透、拖曳             │
└────────┼───────────────────────────────────────────────────────────┘
         │ IPC（shared/ranch-protocol.ts；preload.ts 包成 window.ranchBridge）
         ▼
┌──────────── renderer（src/） ──────────────────────────────────────┐
│ main.ts          依快照新增／移除寵物、判斷睡覺、播提醒、滑鼠點選  │
│ ranch-scene.ts   小島、水、柵欄、樹（地圖資料在 ranch-maps.ts）     │
│ iso-view.ts      等角鏡頭與取景                                     │
│ pet-actor.ts     一隻寶可夢：模型、動作、亂逛、游泳、睡覺、打架     │
│ fights.ts        誰跟誰打架                                         │
│ bubbles.ts       泡泡、名牌、Zzz（HTML 疊層）＋ effects.ts 漫畫符號 │
│ sounds.ts        Web Audio 合成的提醒音                             │
└────────────────────────────────────────────────────────────────────┘
```

分工的原則是：**主行程只管「誰是誰、現在在做什麼」，寵物怎麼動、怎麼畫、播什麼音效全由 renderer 決定。** 主行程不知道牧場長什麼樣子，renderer 也不碰檔案和 hook。

Codex 也可以進同一個 `/hook`：`hooks/codex-hook.py` 先過濾原生事件、轉換工具名稱並補 `provider: codex`。主行程替 Codex session 加上 `codex:` 識別前綴，保存來源與選填的 `session_title`；舊 Claude 事件與存檔預設 `provider: claude`。Codex 不使用 Claude 的 transcript 標題解析器。事件差異、設定與參數見 [codex-hooks.md](codex-hooks.md)。

### 一個事件走一趟

1. Claude 要跑指令，送出 `PreToolUse`。`pet-hook.mjs`（或 macOS 的 `pet-hook.sh`）把 stdin 的 JSON 原封不動 POST 給 App。
2. `hook-server` 只挑出用得到的欄位（`HookEvent`）。說明文字只留 Bash 的 description、檔名或網域這類看不出隱私的東西，其他讀完就丟。
3. `ranch-state` 找到這個 session 的寵物（第一次出現就認養），把狀態設成 `busy`「跑指令：執行型別檢查」。
4. `main.ts` 透過 `ranch:update` 送出整份 `RanchUpdate`（所有寵物＋這次要播的提醒 `cue`）。
5. renderer 的 `applyUpdate` 更新那隻寵物的泡泡。之後每一格把頭頂位置投影到畫面上，擺好泡泡。

子代理的事件（帶 `agent_id`）不另外養寵物，只算「這個 session 還有動靜」，所以寵物不會睡著。

## 目錄結構

```
pokemon-agent-pets/            repo 根目錄（IDEA 專案）
├── README.md                  專案介紹、地圖截圖、快速開始
├── hooks/                     給使用者安裝的 hook（跟桌寵本體分開放，方便單獨下載）
│   ├── pet-hook.mjs           Claude Code hook（跨平台，只需要 Node）：把事件 POST 給 App（裝在 ~/.claude/settings.json）
│   ├── pet-hook.sh            同上的 macOS curl 版
│   ├── codex-hook.py          Codex hook：過濾、轉換事件後 POST 給 App
│   ├── claude-settings.example.json          Claude Code 的 hooks 設定範例（macOS）
│   └── claude-settings.example.windows.json  同上（Windows）
├── docs/                      文件（跟程式分開放）
│   ├── architecture.md        這份
│   ├── install.md             安裝與啟動的完整步驟（每一步有「確認」，可以交給 AI agent 照著做）
│   ├── codex-hooks.md         Codex 接入說明
│   ├── images/                README 用的地圖截圖（只有場景，沒有寶可夢）
│   └── species.html／.csv／.md  151 隻的資料表（agent-pets/scripts/species-table.mjs 產生；HTML 可點標題排序）
├── .idea/runConfigurations/   IDEA 啟動組態：開發、打包、下載模型、啟動／結束 App、動作圖鑑
└── agent-pets/                桌寵本體（IDEA 模組；npm 指令都在這裡跑）
    ├── electron/              主行程（Node）
    │   ├── main.ts            進入點：兩種視窗、選單（寵物／放生、全部放生、模式、桌布螢幕、地圖、重新掃描、打開模型資料夾）、IPC
    │   ├── platform/          各 OS 的設定檔：types.ts（形狀）、darwin.ts、win32.ts、linux.ts、index.ts（依 OS 挑一份）
    │   ├── menu-host.ts       選單掛在 Dock（macOS）或系統匣（Windows、Linux）
    │   ├── hook-server.ts     本機 HTTP 接 hooks
    │   ├── ranch-state.ts     認養與狀態機；ranch.json 原子寫入（tmp＋rename）、30 秒節流
    │   ├── session-meta.ts    從對話紀錄檔尾讀 session 標題（唯讀）
    │   ├── species.ts         模型資料夾位置（MODELS_DIR）、掃描模型、151 隻繁中名稱、尺寸級距
    │   ├── ranch-settings.ts  settings.json：模式、桌布螢幕、地圖
    │   ├── window-place.ts    置頂模式的大小與位置記憶（window.json）；桌布模式的螢幕與取景
    │   ├── app-protocol.ts    app://pet（打包後的畫面）、petmodels://local（models/）
    │   └── preload.ts         把 IPC 包成 window.ranchBridge
    ├── shared/
    │   ├── ranch-protocol.ts  主行程 ↔ renderer 的型別與頻道名稱、地圖清單
    │   └── size-classes.json  每隻的尺寸級距 S／M／L／LL（scripts/species-table.mjs 產生）
    ├── src/                   renderer（瀏覽器端）
    │   ├── main.ts            進入點：快照 → 寵物、睡覺判斷、滑鼠、動畫迴圈
    │   ├── ranch-scene.ts     RanchScene：地面高度網格、泥土側面、柵欄與木門、樹、草叢、花；可站位置與路線判斷
    │   ├── ranch-maps.ts      小島大小（16.4 的圓角正方形）＋八張地圖的水域函式、樹、裝飾位置
    │   ├── iso-view.ts        等角正交鏡頭（轉 45°、俯 30°）與取景
    │   ├── lake.ts            水：湖底深淺、半透明水面、睡蓮蘆葦、水波水花、水裡的隨機點
    │   ├── snow.ts            雪地地圖（雪國小屋）的東西：松林、小木屋、雪屋、路燈、白樺、雪人、浮冰、雪丘、飄雪 Snowfall
    │   ├── camp.ts            中央河（河畔露營）的東西：帳篷、營火、獨木舟、小松樹
    │   ├── volcano.ts         火山口湖的東西：地面配色、火口緣與山坡的石頭、噴氣孔的煙、枯樹
    │   ├── moon.ts            月面基地的東西：月面與隕石坑的配色、大玻璃罩、圓形水池的池框、通到邊緣的通道與門、旗子與天線
    │   ├── npcs.ts            不屬於任何 session 的 NPC（月面基地罩外的皮皮、皮可西與胖丁；RanchMap.npcs、npcZone）
    │   ├── undersea.ts        海底世界的東西：海床配色、玻璃罩、海面與水牆、珊瑚、海草、寶箱、氣泡、魚群；水系浮在不同高度的邏輯在 pet-actor.ts 的 updateUndersea
    │   ├── beach.ts           左側海（海灘）的東西：椰子樹、木棧橋、小船、沙堡、衝浪板、石頭、海星貝殼
    │   ├── batch.ts           蓋擺設用的小工具：同一種材質的零件合併成一個網格（beach.ts、snow.ts、sakura.ts 共用）
    │   ├── sakura.ts          賞櫻地圖（池泉庭園）的東西：櫻花樹、枝垂櫻、太鼓橋、鳥居、小祠、瀑布石組（會動）、後岸的松與石組、鹿威し（會動）、飛石、石燈籠、油菜花、落花與花筏
    │   ├── habitat.ts         哪些是水中、兩棲、陸地；在水裡沉多深
    │   ├── pet-actor.ts       PetActor：載模型、量尺寸、動作、自由活動、游泳、睡覺、打架、逃跑
    │   ├── fights.ts          FightManager：正面撞上的判斷、機率、冷卻、回合數
    │   ├── bubbles.ts         PetOverlay（泡泡、名牌、Zzz、特效）＋ layoutBubbles（泡泡不互相蓋住）
    │   ├── effects.ts         打架的生氣青筋、冒煙，逃跑的汗滴（內嵌 SVG）
    │   ├── sounds.ts          提醒音效（Web Audio 現場合成）
    │   └── style.css          泡泡、名牌、特效的樣式
    ├── showcase/              本機展示網站（npm run showcase，port 5188）：介紹頁（活牧場＋假事件）、動作圖鑑
    ├── scripts/
    │   ├── fetch-models.mjs   下載模型到 models/（固定 commit、逐檔下載、可續傳；跨平台）
    │   ├── verify-model.mjs   檢查每個 GLB（glTF 2.0、全部內嵌、沒有外部網址與陌生擴充）
    │   ├── species-table.mjs  量每隻的高度、合併官方身高體重 → ../docs/species.* 與 shared/size-classes.json
    │   ├── pet-app.mjs        開／關打包好的 App（47821 被佔用就不開；macOS、Windows）
    │   ├── lib/python.mjs     找真的能跑的 Python 3（Windows 的 python3 常是 Store 假捷徑）
    │   ├── draw-icon.swift    畫精靈球圖示（macOS 才能跑；Windows 直接用畫好的 build/icon.png）
    │   └── iso-venue/         等角場地的靜態預覽頁（只有場地、沒有寵物，port 5191）：設計新地圖時先在這裡試
    ├── models/                🔴 寶可夢模型（不進 git，見下面「資料與設定檔」）
    ├── build/                 精靈球圖示（icon.png：系統匣與 Windows exe；icon.icns：macOS Dock）
    ├── index.html             renderer 的頁面（canvas＋疊層）
    ├── vite.config.ts         Vite＋vite-plugin-electron（主行程、preload 一起建）
    ├── electron-builder.yml   打包設定（mac／win 都是 dir、不簽章、模型不打包）
    └── agent-pets.iml         IDEA 模組設定（models、建置輸出設成排除）
```

建置輸出都不進 git（都在 agent-pets/ 底下）：`dist/`（renderer）、`dist-electron/`（主行程）、`release/`（打包好的 App）。

## 模組說明

### 主行程

- **兩種模式**（`main.ts`）
  - 置頂（float）：透明、無邊框、`alwaysOnTop: 'floating'` 的視窗。平常整片滑鼠穿透；renderer 判斷游標在草地或寵物上時才請主行程關掉穿透。拖曳由主行程每 16ms 讀一次游標位置來搬視窗。
  - 桌布（wallpaper）：`type: 'desktop'` 的視窗鋪滿選定的螢幕，收不到滑鼠。
  - 視窗類型不能在執行中改，所以切換模式時是先開新視窗、再關舊的（反過來的話 `window-all-closed` 會讓 App 結束）。
- **跨平台**（`electron/platform/`）：跟 OS 有關的差異都收在一個 OS 一份的設定檔，其他程式只讀 `PLATFORM`，不自己判斷 `process.platform`。地圖、模型、寵物、狀態機、renderer 全部共用。
  | | macOS（darwin.ts） | Windows（win32.ts） |
  |------|------|------|
  | 存檔目錄 | `~/Library/Application Support/Pokemon Ranch Pets` | `%APPDATA%\Pokemon Ranch Pets` |
  | Claude 桌面版資料夾（讀標題） | `~/Library/Application Support/Claude` | `%APPDATA%\Claude` |
  | 選單 | Dock 右鍵 | 系統匣圖示（左右鍵），自己加「結束」 |
  | 桌布模式 | 有 | 沒有（設定裡存 wallpaper 也當 float） |
  | 置頂視窗 | 每個桌面（Spaces）都有 | 不佔工作列按鈕（skipTaskbar） |
  | 路徑比對 | 分大小寫 | 不分大小寫 |

  要支援新的差異：在 `types.ts` 加欄位，每個平台檔各填一個值。測試時可以用 `PET_PLATFORM=win32` 強制換設定檔（只換設定，不會真的變成別的 OS）。
- **選單**（Dock 或系統匣，`menu-host.ts`）：只有內容（寵物清單的文字）變了才重建，並留著最近 5 份選單。之前每個 hook 都重建，打開到一半的「放生」確認就失效了。
- **放生確認**：置頂模式用掛在視窗上的 sheet；桌布模式的視窗在桌面層，掛不了 sheet，改用獨立對話框。「全部放生」（`RanchState.releaseAll`）用同一個確認框，放生的是按下確定那一刻牧場上的全部。
- **地圖**：設定是 `random` 時，每次啟動抽一張，用到結束都不換；指定一張就固定用那張。

### 狀態機（`ranch-state.ts`）

| 事件 | 主 agent 變成 |
|------|------|
| SessionStart | idle（上線） |
| UserPromptSubmit、PostToolUse | busy「思考中…」 |
| PreToolUse | busy「動詞：說明」；AskUserQuestion、ExitPlanMode 是 waiting |
| PostToolUseFailure | error＋錯誤提醒（Esc 中斷不算） |
| PermissionRequest | waiting＋提示音 |
| PreCompact | compacting |
| Stop | idle＋完成提醒 |
| SessionEnd | 不在線（寵物留著，之後去睡覺） |
| PostCompact（Codex） | busy「思考中…」 |
| Interrupt（Codex） | idle，不播放完成提醒 |

另外有兩個逾時：busy 3 分鐘沒消息、waiting 30 分鐘沒消息，都會自動回到 idle，免得漏收事件時一直卡著。

### 場景與地圖

- **座標**：y 朝上，草地在 y = 0。小島是 16.4×16.4 的圓角正方形，中心在原點。鏡頭在右前方（+x、+z），所以畫面上是一塊斜放的菱形。
- **地圖 = 一個水域距離函式** `water(x, z)`：大於 0 在水裡（數字是離岸多遠），小於 0 在岸上。湖底深淺、沙灘寬度、能不能站、柵欄要不要圍，全部從這個函式算。所以新增地圖主要就是寫一個函式，再加上樹和裝飾的位置（`ranch-maps.ts` 的 `MAPS`）。
- **新增地圖的步驟**
  1. 在 `shared/ranch-protocol.ts` 的 `RanchMapId` 與 `RANCH_MAP_LABELS` 加上新 id。
  2. 在 `ranch-maps.ts` 寫地圖。
  3. 有特殊地貌的話，在 `RanchMap.theme` 加一種，並在 `RanchScene.build` 分支處理（參考 snow、sakura）。
     - 擺設多的地圖把位置收成一包資料（賞櫻的 `RanchMap.garden`、雪地的 `RanchMap.village`），蓋的程式放自己的檔案，回傳寵物要繞開的圓（`buildSakuraGarden`、`buildSnowVillage`）。零件多的東西用 `batch.ts` 的 `Batch` 合併，不要一個零件一個網格。
     - 擺設會吃掉寵物能走的地方：大的東西塞進角落、樹貼著後緣種。改完量一下能站的面積（各地圖目前約 57 ～ 116，火山口湖最少），不要比原本少太多。
     - 水要一路到小島邊緣（海）時，另外給 `RanchMap.seabed`：地形、水面、側面的海水斷面照它畫；`water` 還是要在離邊緣一點點的地方歸零，水系才不會游到小島外面（左側海）。
     - 地面要隆起（山）時給 `RanchMap.elevation`，湖要在高處時再給 `waterLevel` 和 `waterOutline`。🔴 寵物只會貼著平地走：隆起的地方、被山擋住看不到的地方都要用 `RanchMap.noGo` 標成誰都不能去（火山口湖）。水系在湖裡不受限，游泳的高度照 `lake.surfaceY` 算。
     - 有一塊陸地被水隔開、走不回來時，用 `RanchMap.offLimits` 標出來，陸地的寵物就不會在那裡出場（賞櫻小溪後面那一塊）。
     - 要讓寵物走到水面上的橋時給 `RanchMap.pier`（左側海的木棧橋）：陸地與兩棲的寵物只從岸上那一頭上下橋（`RanchScene.route` 會先繞到橋頭），站的高度照 `RanchScene.deckY`；橋的兩側、盡頭與後面用 `noGo` 擋住，橋下與橋後面那一窄條在 `water` 裡要算成不是水，水系才進不去。只當裝飾、不讓寵物走的橋（賞櫻的太鼓橋）不用這個。
     - 高的東西（樹、鳥居、橋）放後緣（`z` 或 `x` 接近 -8.2，畫面上方的兩條邊），才不會擋到前面的寵物。
     - 裝飾性的橋要架在很窄的水上（半寬 0.6 以下）：水系挑的目的地離岸至少 0.65，不會游到橋下穿過橋面。
  4. 選單和「隨機」會自動列出新地圖（兩個平台都是）。
  5. 邊改邊看：`npm run showcase` 後開 `http://127.0.0.1:5188/?map=<地圖 id>`，用的是同一套 `RanchScene`，有寵物可以對比例。
- **取景**：`IsoView.fit` 在鏡頭座標裡量小島外框，直接設正交鏡頭的上下左右。主行程依模式給 `IslandFrame`：置頂用 `FLOAT_FRAME`，桌布用 `wallpaperFrame`，會扣掉選單列和 Dock 的位置。螢幕變動（Dock 換螢幕或變大小、進出全螢幕、螢幕插拔）時，主行程經 `ranch:frame` 送新的取景，renderer 原地重新取景，不重新載入頁面，所以寵物不會閃、也不會換位置；縮放比例變了 renderer 自己更新像素比例。會重新載入頁面的只有換地圖、重新掃描模型；切換模式是開一個新視窗。

### 寵物（`pet-actor.ts`）

- **尺寸**：每隻依級距縮放（`SIZES`）：S 0.85、M 1.2、L 1.55、LL 2.1，太長的再用佔地上限縮小。
  - 每個動作的離地高度在模型加進場景**之前**各量一次：先 `skeleton.update()` 再量，不然量到的是綁定姿勢。
  - 會飛的最多浮 0.3 個身高。
- **活動**：idle、walk、run、oneshot（開心、攻擊等一次性動作）、sleep、attention（等你確認時面向鏡頭）、fight。
  - 平常待機幾秒後挑一個直線走得到的目的地，最遠 6.3。中央河兩岸不相連，陸地的寵物只會在自己那一岸挑。
- **棲地**（`habitat.ts`）：水中的 17 隻只在水裡；兩棲的 17 隻偶爾下水、偶爾上岸；其他都是陸地。
  - 在水裡時身體沉下去，由半透明水面蓋住沉下去的部分。
  - 會上下漂，周圍有水波；入水、出水時噴水花。
- **打架**（`fights.ts`）
  - 成立條件：兩隻醒著、距離小於半徑相加加 0.15、夾角 50° 內、在同一種地形。
  - 符合條件後按機率開打。各攻擊 2～3 回合，贏的開心一下，輸的往遠處逃跑。
  - 冷卻：同一對 30 秒內只擲一次骰子，整座牧場兩場架之間至少隔 10 秒。

### 疊層（`bubbles.ts`）

泡泡、名牌、Zzz 和特效是 HTML，不是 3D 物件：

- 每一格把頭頂的世界座標投影到畫面上來擺位置。
- `layoutBubbles` 會把後面那隻的泡泡往上推，泡泡就不會互相蓋住。
- 打架時的特效由 `PetActor.mood`（fight／flee）決定。

## 資料與設定檔

模型放在 `agent-pets/models/`（`.gitignore` 排除，不進 git、不打包進 App）：

| 檔案 | 內容 | 誰寫 |
|------|------|------|
| `models/<編號>/model.glb`、`icon.png` | 151 隻的模型（約 450 MB）＋`animatedModels.json` | `scripts/fetch-models.mjs` |

`electron/species.ts` 的 `MODELS_DIR` 依序找：環境變數 `PET_MODELS_DIR` → 從程式所在位置往上找「有 `models/animatedModels.json` 的資料夾」（開發模式、展示網站、從 `release/` 開的打包 App 都找得到專案根目錄）→ 都找不到才用存檔目錄底下的 `models/`。把打包好的 App 搬到別處（例如「應用程式」、`Program Files`）就會落到這裡。

其他存檔在存檔目錄（macOS `~/Library/Application Support/Pokemon Ranch Pets/`、Windows `%APPDATA%\Pokemon Ranch Pets\`）：

| 檔案 | 內容 | 誰寫 |
|------|------|------|
| `ranch.json` | session_id → 品種、標題、認養時間 | `ranch-state.ts` |
| `settings.json` | `mode`、`wallpaperDisplay`、`map`、`alwaysOnTop` | `ranch-settings.ts` |
| `window.json` | 置頂視窗下緣中點的位置 | `window-place.ts` |

## 開發與測試

在 `agent-pets/` 底下跑（IDEA 的啟動組態也是）：

```bash
npm run dev          # 開發模式（Electron＋Vite）
npm run build        # tsc 型別檢查＋建置
npm run dist:mac     # 打包成 release/mac-arm64/Pokemon Ranch Pets.app
npm run dist:win     # 打包成 release/win-unpacked/Pokemon Ranch Pets.exe
npm run app:open     # 開打包好的 App（app:quit 結束）
npm run showcase     # 展示網站 http://127.0.0.1:5188/
```

| 環境變數 | 用途 | 預設 |
|------|------|------|
| `PET_HOOK_PORT` | hook 的 port；測試時換掉，真的 session 才不會跑進來 | 47821 |
| `PET_DATA_DIR` | 存檔、視窗位置與設定的獨立目錄 | 原本的 Application Support 位置 |
| `RANCH_SLEEP_AFTER_MS` | 多久沒有 hook 就睡覺 | 300000（5 分鐘） |
| `RANCH_FIGHT_CHANCE` | 撞上時開打的機率；設 1 就每次都打 | 0.35 |

測試慣例：

- 用 `PET_DATA_DIR="$(mktemp -d /tmp/pokemon-ranch-test.XXXXXX)" PET_HOOK_PORT=47899 npm run dev` 開隔離牧場，再送假事件。
- `npm test` 自動建立暫存存檔與隨機 port，驗證轉接器、HTTP 及狀態機；不碰使用者的 `ranch.json`。未設 `PET_DATA_DIR` 時仍沿用正式存檔。
- 只想看場景和寵物的改動（不需要 hook），可以直接開展示網站的介紹頁。它用的是同一套 `RanchScene`、`PetActor`，也不會碰 `ranch.json`。
- `tsconfig.json` 檢查 `src`、`electron`、`shared`、`tests`。改了 `src/` 的公開介面，記得也確認 `showcase/` 和 `scripts/iso-venue/` 還編得過。

## 規則

- 🔴 **模型的權利屬於原權利方**，只給本機自用：不進 git、不分享、不打包進 App。專案裡的 `models/` 被 `.gitignore` 整個排除，加檔案時確認不會被 commit。展示網站也只是由開發伺服器直接讀這個資料夾。用模型畫出來的截圖也一樣不進 git。
- 🔴 **hooks 只裝在使用者層級**（`~/.claude/settings.json`），不要再裝到個別專案，不然事件會重複。
- 🔴 **port 47821 一次只給一個程式用**：別的桌寵或 `npm run dev` 占著時，App 收不到 hooks（`npm run app:open` 會先檢查）。
- 終止行程用明確的 PID；只關自己啟動的東西。
