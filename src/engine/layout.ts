// Location helpers and a greedy best-layout solver.
import type { Location, OwnedDroid, Save } from '../domain/save.ts'
import { AREAS, type Area, type GameData } from '../domain/types.ts'
import { computeIncome, tierIncome } from './income.ts'
import { type DefIndex, countsForRequirements, pathOverview, satisfies } from './requirements.ts'
import { slotCounts } from './slots.ts'

export const locKey = (l: Location): string => {
  switch (l.kind) {
    case 'slot':
      return `slot:${l.area}:${l.index}`
    case 'protocol':
      return `protocol:${l.slotId}`
    case 'chip':
      return `chip:${l.station}`
    default:
      return l.kind
  }
}

/** Locations that hold one droid at a time. */
export const isSingle = (l: Location) => l.kind === 'slot' || l.kind === 'protocol' || l.kind === 'chip' || l.kind === 'companion'

/** Moves a droid; if the target holds one droid already, the two swap. */
export function moveDroid(save: Save, uid: string, to: Location): Save {
  const s = structuredClone(save)
  const d = s.droids.find((x) => x.uid === uid)
  if (!d) return s
  if (isSingle(to)) {
    const other = s.droids.find((x) => x.uid !== uid && locKey(x.location) === locKey(to))
    if (other) other.location = d.location
  }
  d.location = to
  return s
}

export interface LayoutPlan {
  droids: OwnedDroid[]
  before: number
  after: number
  movedCount: number
}

/**
 * Greedy: fill earning slots with the highest-earning (droid, area) pairs, keep droids that
 * upcoming rebirths need in the Lounge, and leave protocol / chip / companion placements alone.
 * Hive Mind is applied when scoring the final layout but not while choosing (known simplification).
 */
export function bestLayout(save: Save, data: GameData, defs: DefIndex): LayoutPlan {
  const counts = slotCounts(data, save)
  const fixed = save.droids.filter((o) => ['protocol', 'chip', 'companion'].includes(o.location.kind))
  const pool = save.droids.filter((o) => !fixed.includes(o))
  const scourgeBoost = 1 + data.constants.hiveMind.perOtherScourge * Math.max(0, save.droids.filter((o) => o.tier === 'scourge').length - 1)

  const pairs: { o: OwnedDroid; area: Area; value: number }[] = []
  for (const o of pool) {
    const def = defs.get(o.droidId)
    if (!def || def.class === 'protocol') continue
    const base = tierIncome(defs, o.droidId, o.tier, o.kyber, data)
    for (const area of AREAS) {
      // Iconics earn a share of everything else, so they always get a slot (their own class first).
      const value = def.rarity === 'iconic' ? (def.class === area ? 1e300 : 1e299) :base * (def.class === area ? data.constants.classMatchBonus : 1) * (o.tier === 'scourge' ? scourgeBoost : 1)
      pairs.push({ o, area, value })
    }
  }
  pairs.sort((a, b) => b.value - a.value)
  const used = new Set<string>()
  const next = new Map<string, Location>()
  const fill: Record<Area, number> = { worker: 0, astromech: 0, battle: 0 }
  for (const p of pairs) {
    if (used.has(p.o.uid) || fill[p.area] >= counts.areas[p.area]) continue
    next.set(p.o.uid, { kind: 'slot', area: p.area, index: fill[p.area]++ })
    used.add(p.o.uid)
  }

  // Lounge: droids needed by remaining rebirths, earliest first; then storage.
  const needed: string[] = []
  const trial = { ...save, droids: pool.filter((o) => !used.has(o.uid)) }
  for (const st of pathOverview(save, data, defs))
    for (const r of st.step.droids) {
      const o = trial.droids.find((x) => !needed.includes(x.uid) && satisfies(x, r, defs))
      if (o) needed.push(o.uid)
    }
  let lounge = 0
  for (const uid of needed) {
    if (lounge >= counts.lounge) break
    next.set(uid, { kind: 'lounge' })
    lounge++
  }
  const droids = save.droids.map((o) => {
    if (fixed.includes(o)) return o
    return { ...o, location: next.get(o.uid) ?? (o.location.kind === 'lounge' && lounge++ < counts.lounge ? o.location : { kind: 'storage' as const }) }
  })
  const before = computeIncome(save, data, defs).calibrated
  const after = computeIncome({ ...save, droids }, data, defs).calibrated
  const movedCount = droids.filter((o, i) => locKey(o.location) !== locKey(save.droids[i].location)).length
  return { droids, before, after, movedCount }
}

export const neededCountIn = (save: Save, data: GameData) => save.droids.filter((o) => countsForRequirements(o, data)).length
