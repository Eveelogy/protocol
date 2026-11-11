// Fusion suggestions: what you can fuse right now, and whether it helps an upcoming rebirth.
import type { OwnedDroid, Save } from '../domain/save.ts'
import { type GameData, type Tier, TIERS, tierIndex } from '../domain/types.ts'
import { type DefIndex, pathOverview } from './requirements.ts'

export interface FusionSuggestion {
  kind: 'tier' | 'exclusive'
  result: { droidId: string; tier: Tier }
  uses: string[] // uids consumed
  /** Rebirth levels (in this path) whose requirement the result would newly satisfy. */
  helps: number[]
  /** True if all consumed droids are spare (not the only copy covering a remaining requirement). */
  allSpare: boolean
}

const fusible = (o: OwnedDroid, defs: DefIndex) => o.tier !== 'scourge' && o.tier !== 'kyber' && defs.get(o.droidId)?.rarity !== 'iconic'

/** uids that are the one copy currently covering some remaining requirement. */
function protectedUids(save: Save, data: GameData, defs: DefIndex): Set<string> {
  const s = new Set<string>()
  for (const st of pathOverview(save, data, defs)) for (const r of st.reqs) if (r.metBy) s.add(r.metBy.uid)
  return s
}

function helpsWith(save: Save, data: GameData, defs: DefIndex, result: OwnedDroid, uses: string[]): number[] {
  const before = pathOverview(save, data, defs)
  const after = pathOverview({ ...save, droids: [...save.droids.filter((o) => !uses.includes(o.uid)), result] }, data, defs)
  const out: number[] = []
  after.forEach((st, i) => {
    if (st.missing < before[i].missing) out.push(st.step.from + 1)
  })
  return out
}

export function fusionSuggestions(save: Save, data: GameData, defs: DefIndex): FusionSuggestion[] {
  const prot = protectedUids(save, data, defs)
  const pool = save.droids.filter((o) => fusible(o, defs))
  const out: FusionSuggestion[] = []

  // 3 identical → next tier
  const groups = new Map<string, OwnedDroid[]>()
  for (const o of pool) groups.set(`${o.droidId}@${o.tier}`, [...(groups.get(`${o.droidId}@${o.tier}`) ?? []), o])
  for (const g of groups.values()) {
    if (g.length < 3) continue
    const ordered = [...g.filter((o) => !prot.has(o.uid)), ...g.filter((o) => prot.has(o.uid))]
    const uses = ordered.slice(0, 3).map((o) => o.uid)
    const next = TIERS[tierIndex(g[0].tier) + 1]
    const result: OwnedDroid = { uid: 'preview', droidId: g[0].droidId, tier: next, location: { kind: 'lounge' } }
    out.push({ kind: 'tier', result: { droidId: g[0].droidId, tier: next }, uses, helps: helpsWith(save, data, defs, result, uses), allSpare: uses.every((u) => !prot.has(u)) })
  }

  // Fusion-exclusive recipes where you own all three parts
  for (const fd of data.droids) {
    if (!fd.fusionOf) continue
    const used: OwnedDroid[] = []
    for (const cid of fd.fusionOf) {
      const cands = pool.filter((o) => o.droidId === cid && !used.includes(o)).sort((a, b) => Number(prot.has(a.uid)) - Number(prot.has(b.uid)) || tierIndex(b.tier) - tierIndex(a.tier))
      if (!cands[0]) break
      used.push(cands[0])
    }
    if (used.length !== 3) continue
    const tier = used.reduce<Tier>((m, o) => (tierIndex(o.tier) < tierIndex(m) ? o.tier : m), used[0].tier)
    const uses = used.map((o) => o.uid)
    const result: OwnedDroid = { uid: 'preview', droidId: fd.id, tier, location: { kind: 'lounge' } }
    out.push({ kind: 'exclusive', result: { droidId: fd.id, tier }, uses, helps: helpsWith(save, data, defs, result, uses), allSpare: uses.every((u) => !prot.has(u)) })
  }

  return out.sort((a, b) => b.helps.length - a.helps.length || Number(b.allSpare) - Number(a.allSpare))
}

/** Applies a suggestion: removes the inputs and adds the result to the Lounge. */
export function applyFusion(save: Save, f: FusionSuggestion, uid: string): Save {
  const s = structuredClone(save)
  s.droids = s.droids.filter((o) => !f.uses.includes(o.uid))
  s.droids.push({ uid, droidId: f.result.droidId, tier: f.result.tier, location: { kind: 'lounge' } })
  return s
}
