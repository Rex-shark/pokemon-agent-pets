/**
 * 打架（2026-11-11 使用者要的新功能）：兩隻醒著的寶可夢正面撞在一起時，有機率互相攻擊；
 * 兩隻各連續攻擊 2～3 次（每場隨機，兩隻一樣多），贏的開心一下，輸的往牧場另一頭逃跑。
 *
 * 「正面撞上」：兩隻距離 < 兩隻身體半徑相加＋CONTACT_GAP（大隻的離比較遠就算撞上）、至少一隻正在走或跑，而且兩隻都大致面向對方（夾角 < HEAD_ON_DEG）。
 * 機率：每次相遇只擲一次骰子（同一對有 PAIR_COOLDOWN_MS 冷卻，擦身而過時不會一直重擲）；
 * 整座牧場兩場架之間至少隔 GLOBAL_COOLDOWN_MS，不會一直在打。
 * 睡著、等你確認、正在做別的動作（開心、出錯…）的不會被捲進來；打到一半被叫走（例如 agent 要你確認），另一隻就收手。
 */
import * as THREE from 'three'

import type { PetActor } from './pet-actor'

/** 身體半徑相加之外再多這麼近就算撞上（跟別隻保持的距離剛好是半徑相加，要比它大一點才碰得到） */
const CONTACT_GAP = 0.15
const HEAD_ON_DEG = 50
const PAIR_COOLDOWN_MS = 30_000
const GLOBAL_COOLDOWN_MS = 10_000
/** 每場攻擊幾次（含頭尾，隨機） */
const ROUNDS = { min: 2, max: 3 }

const headOnCos = Math.cos(THREE.MathUtils.degToRad(HEAD_ON_DEG))

export class FightManager {
  private readonly chance: number
  private readonly lastMet = new Map<string, number>()
  private lastFightAt = -Infinity

  /** chance：撞上時開打的機率（0 ~ 1） */
  constructor(chance: number) {
    this.chance = chance
  }

  update(actors: PetActor[], now: number): void {
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]
      if (!a.canFight) continue
      for (let j = i + 1; j < actors.length; j++) {
        const b = actors[j]
        if (!b.canFight || !(a.isMoving || b.isMoving)) continue
        // 水裡的只跟水裡的打（兩棲的在淺灘碰到岸上的也不打）
        if (a.inWater !== b.inWater) continue
        const pa = a.root.position
        const pb = b.root.position
        const ab = new THREE.Vector2(pb.x - pa.x, pb.z - pa.z)
        const d = ab.length()
        if (d >= Math.max(a.radius + b.radius, 0.7) + CONTACT_GAP || d < 1e-4) continue
        ab.divideScalar(d)
        if (a.forward.dot(ab) < headOnCos || b.forward.dot(ab.clone().negate()) < headOnCos) continue

        const key = [a.sessionId, b.sessionId].sort().join('|')
        if (now - (this.lastMet.get(key) ?? -Infinity) < PAIR_COOLDOWN_MS) continue
        this.lastMet.set(key, now)
        if (now - this.lastFightAt < GLOBAL_COOLDOWN_MS || Math.random() >= this.chance) continue
        this.lastFightAt = now
        void this.fight(a, b)
        return
      }
    }
  }

  private async fight(a: PetActor, b: PetActor): Promise<void> {
    const rounds = ROUNDS.min + Math.floor(Math.random() * (ROUNDS.max - ROUNDS.min + 1))
    if (import.meta.env.DEV) console.info(`[fight] ${a.species.name} vs ${b.species.name}（${rounds} 回合）`)
    const started = performance.now()
    const [okA, okB] = await Promise.all([a.startFight(b, rounds), b.startFight(a, rounds)])
    if (!okA || !okB) {
      a.endFight()
      b.endFight()
      return
    }
    const [winner, loser] = Math.random() < 0.5 ? [a, b] : [b, a]
    if (import.meta.env.DEV) {
      console.info(`[fight] ${winner.species.name} 贏了，${loser.species.name} 逃跑（打了 ${((performance.now() - started) / 1000).toFixed(1)} 秒）`)
    }
    winner.winFight()
    loser.loseFight(winner.root.position)
  }
}
