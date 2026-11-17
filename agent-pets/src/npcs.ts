/**
 * 不屬於任何 session 的 NPC（2026-11-16 使用者「玻璃罩外面放兩個皮皮跟 1 隻皮可西當 NPC，隨機動作」；月面基地）。
 *
 * 地圖用 RanchMap.npcs 列出要放誰、放哪裡，RanchMap.npcZone 劃出牠們能站的地方。這裡照著建 PetActor：
 * 跟一般的寵物同一套模型、大小與動作（待機、走、偶爾跑、偶爾開心），只是活動範圍換成 npcZone。
 * - 不認養、不存檔、沒有泡泡與名牌、不會睡著、不接事件
 * - 不跟寵物打架（不交給 FightManager），NPC 彼此也只會互相讓開
 * - 那個品種沒有模型（使用者沒放）就不出現，不報錯
 */
import type { SpeciesInfo } from '../shared/ranch-protocol'
import { PetActor } from './pet-actor'
import { MAPS } from './ranch-maps'
import type { RanchScene } from './ranch-scene'

export class NpcTroupe {
  private actors: PetActor[] = []
  private readonly ranch: RanchScene

  constructor(ranch: RanchScene) {
    this.ranch = ranch
  }

  /** 換地圖或模型清單變了之後呼叫：把舊的 NPC 收掉，照現在這張地圖重新放 */
  reset(speciesById: Map<string, SpeciesInfo>): void {
    for (const actor of this.actors) actor.dispose()
    this.actors = []
    const roam = this.ranch.npcRoam()
    const list = MAPS[this.ranch.mapId].npcs
    if (!roam || !list) return
    list.forEach((npc, i) => {
      const species = speciesById.get(npc.species)
      if (!species) return
      const actor = new PetActor(`npc:${i}`, species, this.ranch, roam, npc.at)
      this.actors.push(actor)
      this.ranch.scene.add(actor.root)
      actor.load().catch((err) => console.error(`[ranch] NPC #${species.id} ${species.name} 模型載入失敗`, err))
    })
  }

  update(dt: number): void {
    for (const actor of this.actors) actor.update(dt, this.actors)
  }
}
