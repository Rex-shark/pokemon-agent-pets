/**
 * 等角鏡頭（2026-11-12 使用者想試試等角透視的場地，選了「菱形（轉 45°）」；之後「做成正方形」、原本的透視鏡頭拿掉，
 * 現在牧場只用這個）：正交鏡頭、水平轉 45°、往下看 30°，遠近一樣大。正方形的小島在畫面上是斜放的菱形，
 * 像經典模擬經營遊戲那種 45° 地圖；畫面四個角是空的（透明，桌布模式看得到原本的桌布）。
 *
 * - 往下看 30° 而不是正等角的 35.26°：菱形的寬高比是 1 / sin(俯角)，30° 是 2:1（經典像素等角的比例），
 *   比較貼近寬螢幕，寵物在畫面上可以比較大（差不多跟原本透視鏡頭的牧場中段一樣大）。
 * - 鏡頭在右前方（+x、+z）：左側海（原本的左側湖）在菱形的左上邊，陸地在右下，寵物大多在前面、不被水擋住。
 * - 取景照主行程給的 IslandFrame（左右撐到 frame.width、底部在 -frame.bottom），
 *   但菱形的頂端是一個尖角，只有那附近的泡泡會頂到畫面上緣，上方只保留 frame.top 的 TOP_RESERVE_RATIO 倍。
 * - 泡泡、特效（camera.project）、滑鼠點選（Raycaster.setFromCamera）、寵物面向鏡頭都直接吃這個鏡頭（RanchScene.camera）。
 * - 遠近一樣大之後，前後遮擋只靠深度：靠前（畫面下方）的寵物蓋住後面的，泡泡也照腳在畫面上的高低排（bubbles.ts 的 depth）。
 */
import * as THREE from 'three'

import type { IslandFrame } from '../shared/ranch-protocol'
import { CZ, outline } from './ranch-maps'

/** 水平轉幾度（鏡頭從右前方看） */
const YAW = THREE.MathUtils.degToRad(45)
/** 往下看幾度 */
const PITCH = THREE.MathUtils.degToRad(30)
/** 鏡頭離小島中心多遠（正交投影跟距離無關，只要不切到東西） */
const DISTANCE = 60
/** 上方保留給泡泡的空間：frame.top 的幾倍（菱形頂端是尖角，不用整條都留；原本透視鏡頭是整條 frame.top） */
const TOP_RESERVE_RATIO = 0.45

export class IsoView {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, DISTANCE * 2)
  /** 取景用：小島外緣（含泥土的倒角）在柵欄頂與泥土底的高度 */
  private readonly rim: THREE.Vector3[] = []

  constructor() {
    const target = new THREE.Vector3(0, 0, CZ)
    const dir = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH))
    this.camera.position.copy(target).addScaledVector(dir, DISTANCE)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
    for (const v of outline(-0.12, 160)) for (const y of [0.45, -0.86]) this.rim.push(new THREE.Vector3(v.x, y, v.y))
  }

  /** 取景：在鏡頭座標裡量小島外緣，直接設正交鏡頭的上下左右（不用 zoom、setViewOffset） */
  fit(w: number, h: number, frame: IslandFrame): void {
    const cam = this.camera
    const inv = cam.matrixWorldInverse
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    const p = new THREE.Vector3()
    for (const v of this.rim) {
      p.copy(v).applyMatrix4(inv)
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    const aspect = w / h
    // NDC 是 -1 ~ 1：寬度可用 2×frame.width；高度從底（-frame.bottom）到上緣保留區
    const availH = 1 - 2 * frame.top * TOP_RESERVE_RATIO + frame.bottom
    // 半寬（鏡頭座標）：寬、高兩個限制取比較嚴的
    const hw = Math.max((maxX - minX) / (2 * frame.width), ((maxY - minY) / availH) * aspect)
    const hh = hw / aspect
    const cx = (minX + maxX) / 2
    // 小島底（minY）要落在 NDC 的 -frame.bottom
    const cy = minY + frame.bottom * hh
    cam.left = cx - hw
    cam.right = cx + hw
    cam.top = cy + hh
    cam.bottom = cy - hh
    cam.updateProjectionMatrix()
  }
}
