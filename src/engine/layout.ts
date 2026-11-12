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
 * Best layout = improve-only local search, scored with the full income model (class match,
 * protocol area bonuses, Hive Mind, Iconic shares). It starts from your current layout and from a
 * greedy guess, and keeps whichever ends higher, so it can never suggest a downgrade. It never
 * leaves fewer upcoming rebirth requirements covered than you have now, and leaves chip station
 * and companion placements alone.
 */
export function bestLayout(save: Save, data: GameData, defs: DefIndex): LayoutPlan {
  const score = (droids: OwnedDroid[]) => computeIncome({ ...save, droids }, data, defs, droids).total
  const missing = (droids: OwnedDroid[]) => pathOverview({ ...save, droids }, data, defs).reduce((s, st) => s + st.missing, 0)
  const baseMissing = missing(save.droids)
  const counts = slotCounts(data, save)

  const fromCurrent = improve(save.droids, counts, defs, score, missing, baseMissing)
  const seed = greedySeed(save, data, defs).droids
  const fromGreedy = missing(seed) <= baseMissing ? improve(seed, counts, defs, score, missing, baseMissing) : null
  const best = fromGreedy && score(fromGreedy) > score(fromCurrent) * (1 + 1e-9) ? fromGreedy : fromCurrent

  const before = computeIncome(save, data, defs).calibrated
  const after = computeIncome({ ...save, droids: best }, data, defs, best).calibrated
  const movedCount = best.filter((o, i) => locKey(o.location) !== locKey(save.droids[i].location)).length
  // Rounding guard: only report a change if it actually helps.
  if (after <= before * (1 + 1e-6)) return { droids: save.droids, before, after: before, movedCount: 0 }
  return { droids: best, before, after, movedCount }
}

/** Positions the search may fill: unlocked earning slots and unlocked protocol slots. */
function positions(counts: ReturnType<typeof slotCounts>): Location[] {
  const out: Location[] = []
  for (const area of AREAS) for (let i = 0; i < counts.areas[area]; i++) out.push({ kind: 'slot', area, index: i })
  for (const id of counts.protocol) out.push({ kind: 'protocol', slotId: id })
  return out
}

/**
 * First-improvement hill climb over "put droid X into position P" (swapping with whoever is there).
 * Droids keep their array order so results line up with the original save.
 */
function improve(
  start: OwnedDroid[],
  counts: ReturnType<typeof slotCounts>,
  defs: DefIndex,
  score: (d: OwnedDroid[]) => number,
  missing: (d: OwnedDroid[]) => number,
  maxMissing: number,
): OwnedDroid[] {
  let cur = start.map((o) => ({ ...o }))
  let curScore = score(cur)
  const pos = positions(counts)
  const movable = (o: OwnedDroid) => ['slot', 'protocol', 'lounge', 'storage'].includes(o.location.kind)
  const fits = (o: OwnedDroid, p: Location) => {
    const cls = defs.get(o.droidId)?.class
    return p.kind === 'protocol' ? cls === 'protocol' : cls !== 'protocol'
  }
  for (let round = 0; round < 300; round++) {
    let improved = false
    for (const p of pos) {
      const key = locKey(p)
      const occupantIdx = cur.findIndex((o) => locKey(o.location) === key)
      for (let i = 0; i < cur.length; i++) {
        const c = cur[i]
        if (i === occupantIdx || !movable(c) || !fits(c, p)) continue
        const next = cur.map((o) => ({ ...o }))
        const from = c.location
        next[i].location = p
        if (occupantIdx >= 0) {
          const occ = next[occupantIdx]
          // A protocol droid can't go into an earning slot (and vice versa): park it in the Lounge instead.
          occ.location = from.kind === 'slot' || from.kind === 'protocol' ? (fits(occ, from) ? from : { kind: 'lounge' }) : from
        }
        const s = score(next)
        if (s <= curScore * (1 + 1e-9)) continue
        const touchesStorage = from.kind === 'storage' || (occupantIdx >= 0 && next[occupantIdx].location.kind === 'storage')
        if (touchesStorage && missing(next) > maxMissing) continue
        if (next.filter((o) => o.location.kind === 'lounge').length > Math.max(counts.lounge, cur.filter((o) => o.location.kind === 'lounge').length)) continue
        cur = next
        curScore = s
        improved = true
        break
      }
    }
    if (!improved) break
  }
  return cur
}

/** Greedy guess used as a second starting point: highest raw earners into matching slots. */
function greedySeed(save: Save, data: GameData, defs: DefIndex): { droids: OwnedDroid[] } {
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
  return { droids }
}

export const neededCountIn = (save: Save, data: GameData) => save.droids.filter((o) => countsForRequirements(o, data)).length
