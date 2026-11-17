# 寶可夢牧場（Pokemon Ranch Pets）

桌面右下角一塊透明背景的 3D 小牧場，**每個 Claude Code／Codex session 隨機認養一隻寶可夢**，
寵物在牧場裡自由走動，頭上的雲朵泡泡顯示 agent 正在做什麼。

Codex 的轉接腳本是 repo 根目錄的 `hooks/codex-hook.py`；可用 `--print-config` 產生設定、`--dry-run` 檢查事件。參數與安裝方式見 [Codex 接入說明](../docs/codex-hooks.md)。`npm test` 可執行隔離的 hook 與狀態機測試。

技術：Electron（透明、無邊框、置頂視窗）＋ Vite ＋ TypeScript ＋ three.js（讀 GLB 模型、播骨骼動畫）。

## 功能

| 情況 | 寵物 |
|------|------|
| 新 session 第一次有 hook | 從牧場上還沒有的品種裡隨機認養一隻，用 session_id 記在 `ranch.json`，重開 App 還在 |
| 平常 | 自由活動：待機、走、偶爾跑、偶爾開心 |
| agent 在做事 | 頭上白色雲朵泡泡：「跑指令：執行型別檢查」 |
| 等你確認（權限、問問題、計畫） | 黃色泡泡＋跳動、停下來面向你、叮咚聲 |
| 工具失敗 | 紅色泡泡、播攻擊動作、低音提示聲 |
| 整理記憶 | 淡紫泡泡 |
| 做完一輪 | 綠色「做完了！」、播開心動作、上揚三音 |
| 5 分鐘沒有 hook | 有睡覺動作的寶可夢（151 隻裡有 114 隻）躺下睡覺、飄 Zzz；下一個 hook 就醒來 |
| session 結束 | 寵物**不會消失**，只是之後會去睡覺；要拿掉從選單（Dock 圖示右鍵／Windows 系統匣圖示）「放生」；「全部放生」一次清空（確認後才放，還在線上的 session 之後會重新認養） |
| 兩隻醒著的正面撞上 | 35% 機率打架：面對面各連續攻擊 2～3 次（每場隨機；攻擊動作 1.7 倍速、每招最多 1.7 秒，`src/pet-actor.ts` 的 `FIGHT_ATTACK_SPEED`），隨機一隻贏（開心），輸的往牧場另一頭逃跑；同一對 30 秒內只擲一次骰子、整座牧場兩場架至少隔 10 秒（`src/fights.ts`）；打架時頭邊有紅色生氣青筋與白色冒煙（各 1～3 個、位置隨機），輸的逃跑時頭上冒汗滴（`src/effects.ts`） |

- 子代理不另外養寵物；子代理的事件只算「這個 session 還有動靜」（不會睡著），子代理要權限時一樣變黃。
- 滑鼠：游標在草地上才接滑鼠，其他地方點得到後面的視窗。點寵物＝摸一下（開心＋名牌），按住草地拖曳＝搬牧場。
- 場地：一塊圓角正方形的小島（16.4×16.4，`src/ranch-maps.ts` 的 `RANCH`），八張地圖（選單「地圖」切換，記在 `settings.json`；預設「隨機」：每次 App 啟動抽一張，抽到後到結束都不換，選某一張就固定用那張）：
  左側海（海灘：左邊是海、海水到小島邊緣，右邊是沙灘再接草地；椰子樹、伸進海裡的木棧橋、小船、沙堡、衝浪板，`src/beach.ts`；陸地與兩棲的寵物會從岸上那一頭走上棧橋，橋下的水誰都不能進（2026-11-13 使用者「把燈塔移除，那個位置改為海邊會出現的那種木橋」）；
  2026-11-12 使用者「左側湖改為左側海，風格是海灘」，地圖 id 還是 `lake-left`）、
  火山口湖（靠後面一座隆起的活火山、湖在山頂，深色火山岩、硫磺黃的湖岸、噴氣孔冒煙、枯樹，沒有岩漿；水系在山頂的湖裡，其他寵物在山下的平地，
  不會上山也不會跑到山後面，`src/volcano.ts`；2026-11-12 使用者「中央湖改為火山口湖」，地圖 id 還是 `lake-center`）、
  中央河（河畔露營：河從菱形左角流到右角，兩頭跟原本一樣、中段微微 S 彎，陸地的寵物過不去；上岸是沙地，頂角有帳篷、營火、獨木舟和兩棵小松樹，下岸是草地，`src/camp.ts`；
  2026-11-12 使用者「中央河你也重構一版，河改彎（S）一些」重做）、
  雪地（雪國小屋：花生形的湖、頂角一間亮著燈的小木屋、後緣一整排積雪的松林、雪屋、路燈與鏟過雪的小路、白樺、雪人、浮冰、飄雪，`src/snow.ts`；
  2026-11-12 使用者「雪地你重構一版」重做，湖沒動）、
  日式賞櫻（池泉庭園：河沿右上邊流進右角前面的池、最左邊靠邊緣的一小段是細細的小溪，朱紅的太鼓橋架在上面，通到後岸的鳥居與小祠、池子後岸的瀑布石組（瀑布從石山落進池子）、後岸一排松樹與石組加一座石塔、左邊一棵枝垂櫻、
  飛石小徑、石燈籠、池邊的油菜花、橋頭右前方草地上會動的鹿威し（筧滴水、竹筒裝滿就倒進石缽，2026-11-13 加的）、整圈柵欄把池子圍在裡面（2026-11-13 使用者選定瀑布組與松石組、「右邊也用圍欄圍起來」）、地上的落花、水面的花筏、飄花瓣，`src/sakura.ts`；2026-11-12 使用者「櫻花版太醜了，設計個新的」重做）。水系在水裡游。
  中央島（四面環海的小沙島：整座島都是沙、左側一棵往左彎的大椰子樹（一般的樹幹、Q 版的寬葉子與兩顆大椰子）、沙灘上一顆紅色手印臉的排球、兩個沖上岸的快遞包裹（白紙箱、紫橘色帶子，不放品牌字樣）、一艘船頭翹起、半埋在沙裡的黃色橡皮艇，還撒了海星、貝殼和海螺；水一路到小島邊緣、四周沒有柵欄與木門，水系繞著島游，
  `src/beach.ts`；2026-11-13 新增的第六張，地圖 id 是 `islet`）、
  月面基地（灰色的月面上一個淡淡透明藍的大玻璃罩，罩子正中央有一座圓形水池，四周一圈陸地（2026-11-16 使用者先要彎月形、再改半圓，最後定案「水改圓形，在中央」）；罩子往畫面左下接一段玻璃通道，通到小島邊緣的一扇門（深色門板、圓窗、橘燈）；罩外的月面緩緩起伏，四個角和幾條邊上有隕石坑（坑底凹、坑緣隆起）；寵物只待在罩子和通道裡（出生點也是），整圈沒有柵欄與木門；
  罩外有 10 隻皮皮、2 隻皮可西和 1 隻胖丁當 NPC，自己走動、偶爾開心，不屬於任何 session、沒有泡泡與名牌，`src/moon.ts`、`src/npcs.ts`；2026-11-16 新增的第七張，地圖 id 是 `moon`）。
  海底世界（整座島沉在海裡，上面一片會閃光紋的半透明海面、四周一圈淡藍水牆，像一缸水族箱；中間一個大玻璃罩（半徑 5.4，2026-11-17 使用者「陸地再大一些」），裡面是長著樹、草叢與花的陸地，陸地寵物只待在罩子裡；罩外是海，水系和兩棲的寶可夢（使用者「水陸兩用的也判斷丟到水中」）浮在海床上 0.3～1.3 之間的某個高度，每隔一陣子換一個高度慢慢飄過去，大隻的頭不會冒出海面，海床上的影子浮越高越大越淡；海床上有珊瑚、會晃的海草、礁石與海葵、半開的寶箱、往上冒的氣泡、兩群繞著罩子游的小魚、從海面斜照下來的光，`src/undersea.ts`；2026-11-17 新增的第八張，使用者「海底世界跟月面相反，中間一個罩子，裡面是陸地」，高度用「浮在不同高度」的做法，地圖 id 是 `undersea`）。
  用等角鏡頭（`src/iso-view.ts`：正交、水平轉 45°、往下看 30°）看，畫面上是一塊斜放的菱形，遠近一樣大；鏡頭會自動取景讓小島撐滿視窗。
  2026-11-12 使用者：原本的透視鏡頭與那組長方形地圖（含全背景）都拿掉，改成等角正方形。
- **兩種模式**（選單切換，記在 `settings.json`；Windows 只有置頂小牧場）：
  - 置頂小牧場（預設）：透明、置頂、可拖曳、可點寵物。選單「置頂」可以關掉置頂（記在 `settings.json` 的 `alwaysOnTop`）。
  - 桌布模式（只有 macOS）：`type: 'desktop'` 的視窗鋪滿選定的螢幕，在所有視窗與桌面圖示底下，透明背景看得到原本的桌布；收不到滑鼠（不能點寵物、拖曳），放生的確認框改成獨立對話框（出現在主螢幕）。「桌布放在哪個螢幕」可選，選的螢幕拔掉就用主螢幕。做法照 live2d-desktop。
- 視窗：螢幕放不下就等比例縮到工作區的 95%（外接螢幕開 HiDPI 時可能只有 960×540 點）；拖到哪個螢幕就換成適合那個螢幕的大小，位置記在 `window.json`，下次開在同一個地方。
- **尺寸級距**（`shared/size-classes.json`，由 `scripts/species-table.mjs` 產生）：S／M／L 照待機高度由矮到高 30%／40%／30%（44／59／45 隻），大岩蛇、卡比獸、暴鯉龍手動指定 LL。牧場上的高度 S 0.85、M 1.2、L 1.55、LL 2.1（`src/pet-actor.ts` 的 `SIZES`）；跟別隻保持的距離、多近算撞上都看身體半徑。要改 LL 名單：改腳本的 `MANUAL_CLASS` 再重跑 `node scripts/species-table.mjs`，然後重新打包。
- 資料表：repo 根目錄的 [`docs/species.html`](../docs/species.html)（點標題排序）、`docs/species.csv`、`docs/species.md`，同一支腳本產生。
- 會飛的寶可夢：每個動作的離地高度開模型時各量一次，最多浮 0.3 個身高，不會飛出牧場。
- 音效用 Web Audio 現場合成，沒有音檔。

## 第一次使用

```bash
npm install
node node_modules/electron/install.js   # npm 擋了 install script 時，手動下載 Electron 本體
npm run setup:models                    # 下載寶可夢模型（約 470 MB，可以中斷後重跑；只抓幾隻：node scripts/fetch-models.mjs 025 133）
npm run dev                             # 開發模式
```

打包：macOS `npm run dist:mac` → `release/mac-arm64/Pokemon Ranch Pets.app`；Windows `npm run dist:win` → `release/win-unpacked/Pokemon Ranch Pets.exe`。開／關：`npm run app:open`、`npm run app:quit`（IDEA 執行組態「寶可夢牧場 打包（Mac／Windows）／啟動 App／結束 App」）。

🔴 hooks 用 repo 根目錄的 `hooks/pet-hook.mjs`（macOS 也可以用 `pet-hook.sh`），送到 `127.0.0.1:47821`，**這個 port 一次只能給一個程式用**（打包好的 App 和 `npm run dev` 不能同時開）。
測試時使用獨立存檔與 port：`PET_DATA_DIR="$(mktemp -d /tmp/pokemon-ranch-test.XXXXXX)" PET_HOOK_PORT=47899 RANCH_SLEEP_AFTER_MS=20000 npx vite`（Windows PowerShell：`$env:PET_DATA_DIR="$env:TEMP\ranch-test"; $env:PET_HOOK_PORT=47899; npx vite`）；`RANCH_FIGHT_CHANCE=1` 撞上就打（預設 0.35）。

## 模型

- 來源：[06wj/pokemon](https://github.com/06wj/pokemon)（固定 commit `00d96f7`），第一代 151 隻，GLB（glTF 2.0，貼圖、骨骼動畫都內嵌）。
- 放在專案裡的 `models/<編號>/model.glb`（`.gitignore` 整個排除，任何 `*.glb` 也不進 git）。App 從自己的位置往上找專案的 `models/`，開發模式、展示網站、從 `release/` 開的打包 App 都讀這裡；環境變數 `PET_MODELS_DIR` 可以改，都找不到才用存檔目錄底下的 `models/`（`electron/species.ts` 的 `MODELS_DIR`）。
- 牧場存檔 `ranch.json`、視窗位置 `window.json`、模式設定 `settings.json` 在存檔目錄：macOS `~/Library/Application Support/Pokemon Ranch Pets/`、Windows `%APPDATA%\Pokemon Ranch Pets\`（`electron/platform/`）。
- 🔴 原專案的程式是 MIT，但**角色模型的權利屬於原權利方，原作者明說不授予使用權**：只給本機自用，不進 git、不分享、不打包進 App。
- `scripts/fetch-models.mjs` 只下載資料檔、不執行原專案任何程式；每個 GLB 先用 `scripts/verify-model.mjs` 檢查（glTF 2.0、全部內嵌、沒有外部網址、沒有不認得的擴充）才搬進模型資料夾。

## 展示網站

```bash
npm run showcase   # http://127.0.0.1:5188/
```

- 「模組介紹」：一座活的小牧場（直接用 `src/` 的場景、寵物、泡泡、音效程式，唯讀引用），可以送假事件看泡泡顏色、睡覺、打架。
  網址加 `?map=<地圖 id>` 換地圖（`lake-center`、`river`、`snow`、`sakura`、`islet`），設計、調整地圖時用，例如 <http://127.0.0.1:5188/?map=sakura>。
- 「動作圖鑑」：151 隻可搜尋的清單，點一隻用 three.js 看 3D 模型，切換 idle／walk／run／attack／happy／sleep，可旋轉縮放。
- 🔴 模型與頭像由開發伺服器（`showcase/vite.config.ts` 的 middleware）直接讀上面的模型資料夾，**不複製、不建連結、不 build**，只在本機看。
- 用 port 5188，不碰桌寵的 47821，可以跟 App 同時開。

## 檔案

程式怎麼分工、資料怎麼流、怎麼新增地圖：見 [docs/architecture.md](../docs/architecture.md)（在 repo 根目錄的 `docs/`）。

```
electron/main.ts           視窗（置頂／桌布）、選單（寵物與放生、全部放生、模式、桌布螢幕、地圖、重新掃描模型）、滑鼠穿透與拖曳
electron/platform/         各 OS 的設定檔（darwin.ts、win32.ts、linux.ts）：存檔位置、選單掛哪、有沒有桌布模式、視窗選項；index.ts 依 OS 挑一份
electron/menu-host.ts      選單掛在 Dock（macOS）或系統匣（Windows）
electron/hook-server.ts    接 hooks（照抄 live2d-fantastic-days：只聽 127.0.0.1、拒絕帶 Origin 的請求、只取安全的簡短說明）
electron/ranch-state.ts    認養（存檔）＋每個主 agent 的狀態機
electron/session-meta.ts   查 session 標題（照抄 live2d-fantastic-days，唯讀）
electron/species.ts        App 資料夾位置、掃描模型資料夾、繁中名稱、尺寸級距
electron/ranch-settings.ts 模式、桌布螢幕、地圖的設定（settings.json）
electron/window-place.ts   置頂模式的大小與位置記憶；桌布模式的螢幕與取景
electron/app-protocol.ts   app://pet（打包後的畫面）、petmodels://local（專案裡的 models/）
electron/preload.ts        把 IPC 包成 window.ranchBridge
shared/ranch-protocol.ts   主行程 ↔ renderer 的訊息格式、地圖清單
shared/size-classes.json   每隻的尺寸級距（scripts/species-table.mjs 產生）
src/main.ts                renderer 入口：快照 → 寵物、睡覺判斷、滑鼠、動畫迴圈
src/ranch-scene.ts         牧場場景（程式產生：地面、泥土側面、柵欄與木門、樹、草叢、花）＋能不能站、路線判斷
src/ranch-maps.ts          小島大小（正方形）、八張地圖（左側海、火山口湖、中央河、雪地、日式賞櫻、中央島、月面基地、海底世界）的水與樹
src/moon.ts                月面基地的東西：月面與隕石坑的配色、大玻璃罩、圓形水池的池框、通到邊緣的通道與門、旗子與天線
src/npcs.ts                不屬於任何 session 的 NPC（月面基地罩外的皮皮、皮可西與胖丁）
src/undersea.ts            海底世界的東西：海床與罩子裡草地的配色、玻璃罩、海面與水牆、珊瑚、海草、寶箱、氣泡、魚群、光柱
src/iso-view.ts            等角鏡頭與取景：正交鏡頭轉 45°、俯 30°，小島在畫面上是菱形，遠近一樣大
src/lake.ts                水：湖底深淺、半透明水面、睡蓮蘆葦、水波水花
src/snow.ts                雪地（雪國小屋）的東西：松林、小木屋、雪屋、路燈、白樺、雪橇、雪人、雪丘、浮冰、柵欄柱頭的雪、飄雪（Snowfall，賞櫻也拿來飄花瓣）
src/camp.ts                中央河（河畔露營）的東西：帳篷、營火（會晃的火焰與煙）、獨木舟、當椅子的木頭、小松樹
src/volcano.ts             火山口湖的東西：地面配色、火口緣與山坡的石頭、噴氣孔的煙、枯樹
src/beach.ts               左側海（海灘）的東西：椰子樹、木棧橋、小船、沙堡、海灘球、衝浪板、石頭、海星貝殼
src/batch.ts               蓋擺設用的小工具：同一種材質的零件合併成一個網格（beach.ts、snow.ts、sakura.ts 共用）
src/sakura.ts              日式賞櫻（池泉庭園）的東西：櫻花樹、枝垂櫻、太鼓橋、鳥居、小祠、瀑布石組（會動）、後岸的松與石組、鹿威し（會動）、飛石、石燈籠、油菜花、落花與花筏、花瓣的樣子
src/habitat.ts             水中／兩棲／陸地的名單、在水裡沉多深
src/pet-actor.ts           一隻寶可夢：載模型、動作、自由活動、游泳、睡覺、打架
src/fights.ts              正面撞上時打架（機率、冷卻、勝負）
src/bubbles.ts             雲朵泡泡、名牌、Zzz
src/effects.ts             打架的生氣青筋、冒煙，逃跑的汗滴
src/sounds.ts              提醒音效
scripts/                   下載與檢查模型、產生資料表、開關 App、畫圖示；iso-venue/ 是設計新地圖用的等角場地預覽頁
build/icon.png、icon.icns   精靈球圖示：scripts/draw-icon.swift 畫 PNG，再用 sips＋iconutil 轉 icns（macOS Dock）；Windows 的 exe 圖示與系統匣直接用 icon.png
showcase/                  本機用的展示網站（npm run showcase）：介紹頁＋動作圖鑑
../docs/                   （repo 根目錄）專案說明與結構（architecture.md）、開源計畫、151 隻的資料表
```
