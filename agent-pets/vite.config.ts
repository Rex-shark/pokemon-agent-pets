import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  // 打包後的 Electron 用 file:// 載入 dist/index.html，資源路徑要是相對的
  base: './',
  plugins: [
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        // 外掛在 "type": "module" 的專案會把 CommonJS 輸出成 .mjs，Electron 會誤當 ESM；sandbox 的 preload 只能是 CommonJS
        vite: { build: { rolldownOptions: { output: { entryFileNames: '[name].cjs' } } } },
      },
    }),
  ],
})
