/**
 * 提醒音效：用 Web Audio 現場合成，不需要音檔（也就沒有授權問題）。
 *
 * - waiting（等你確認）：叮咚兩聲，明亮
 * - error（工具失敗）：往下滑的兩聲低音
 * - done（做完一輪）：往上的三個音，輕快
 *
 * 同一種提醒短時間內只響一次（好幾隻同時完成時不會吵成一團）。
 */
import type { RanchCue } from '../shared/ranch-protocol'

let ctx: AudioContext | null = null
const lastPlayed = new Map<RanchCue, number>()
const MIN_GAP_MS = 1200

interface Note {
  /** 頻率（Hz） */
  freq: number
  /** 從現在開始幾秒後響 */
  at: number
  /** 長度（秒） */
  dur: number
  type?: OscillatorType
  /** 滑音到這個頻率 */
  slideTo?: number
  gain?: number
}

const CUES: Record<RanchCue, Note[]> = {
  waiting: [
    { freq: 1046.5, at: 0, dur: 0.35, type: 'sine', gain: 0.32 },
    { freq: 784, at: 0.22, dur: 0.55, type: 'sine', gain: 0.3 },
  ],
  error: [
    { freq: 330, at: 0, dur: 0.18, type: 'square', slideTo: 260, gain: 0.12 },
    { freq: 247, at: 0.2, dur: 0.32, type: 'square', slideTo: 175, gain: 0.12 },
  ],
  done: [
    { freq: 659.3, at: 0, dur: 0.16, type: 'triangle', gain: 0.28 },
    { freq: 784, at: 0.12, dur: 0.16, type: 'triangle', gain: 0.28 },
    { freq: 1046.5, at: 0.24, dur: 0.4, type: 'triangle', gain: 0.28 },
  ],
}

function play(note: Note, audio: AudioContext): void {
  const start = audio.currentTime + note.at
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = note.type ?? 'sine'
  osc.frequency.setValueAtTime(note.freq, start)
  if (note.slideTo) osc.frequency.exponentialRampToValueAtTime(note.slideTo, start + note.dur)
  // 很短的起音＋指數衰減，聽起來像敲擊而不是嗶聲
  const peak = note.gain ?? 0.25
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur)
  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + note.dur + 0.05)
}

export function playCue(kind: RanchCue): void {
  const now = performance.now()
  if (now - (lastPlayed.get(kind) ?? -Infinity) < MIN_GAP_MS) return
  lastPlayed.set(kind, now)
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  for (const note of CUES[kind]) play(note, ctx)
  if (import.meta.env.DEV) console.info(`[sound] ${kind}`)
}
