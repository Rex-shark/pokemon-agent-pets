/**
 * 給 renderer 的唯一入口：window.ranchBridge。renderer 碰不到 ipcRenderer 本身（contextIsolation）。
 * sandbox 下的 preload 必須是 CommonJS，vite.config.ts 把它輸出成 preload.cjs。
 */
import { contextBridge, ipcRenderer } from 'electron'

import {
  RANCH_CONFIG_CHANNEL,
  RANCH_DRAG_CHANNEL,
  RANCH_FRAME_CHANNEL,
  RANCH_MOUSE_THROUGH_CHANNEL,
  RANCH_UPDATE_CHANNEL,
  type IslandFrame,
  type RanchBridge,
  type RanchUpdate,
} from '../shared/ranch-protocol'

const bridge: RanchBridge = {
  getConfig: () => ipcRenderer.invoke(RANCH_CONFIG_CHANNEL),
  onUpdate(callback) {
    const listener = (_event: Electron.IpcRendererEvent, update: RanchUpdate) => callback(update)
    ipcRenderer.on(RANCH_UPDATE_CHANNEL, listener)
    return () => ipcRenderer.removeListener(RANCH_UPDATE_CHANNEL, listener)
  },
  onFrame(callback) {
    const listener = (_event: Electron.IpcRendererEvent, frame: IslandFrame) => callback(frame)
    ipcRenderer.on(RANCH_FRAME_CHANNEL, listener)
    return () => ipcRenderer.removeListener(RANCH_FRAME_CHANNEL, listener)
  },
  /** true：滑鼠穿透（點到後面的視窗）；false：視窗自己接滑鼠（游標在牧場、寵物或泡泡上） */
  setMouseThrough: (through) => ipcRenderer.send(RANCH_MOUSE_THROUGH_CHANNEL, through),
  /** 拖曳視窗：按下時 'start'、放開時 'end'；移動由主行程跟著游標做 */
  drag: (phase) => ipcRenderer.send(RANCH_DRAG_CHANNEL, phase),
}

contextBridge.exposeInMainWorld('ranchBridge', bridge)
