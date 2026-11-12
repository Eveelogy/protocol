// Upgrade chip stations: production rate, storage cap, and where chips are needed.
import type { OwnedDroid, Save } from '../domain/save.ts'
import { type GameData, type Rarity, type Tier, tierIndex } from '../domain/types.ts'
import { computeIncome } from './income.ts'
import type { NeededItem } from './plan.ts'
import type { DefIndex } from './requirements.ts'
import { slotCounts } from './slots.ts'

const RARITY_RANK: Partial<Record<Rarity, number>> = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 }

/** Default = 1 … Kyber = 8. Scourge rate is unconfirmed; assumed equal to Stellar. */
const tierRank = (t: Tier) => (t === 'scourge' ? tierIndex('stellar') : tierIndex(t)) + 1

/** Chips per minute a droid produces in a station (Iconics can't be placed). */
export function stationRate(o: Pick<OwnedDroid, 'droidId' | 'tier'>, defs: DefIndex, data: GameData): number {
  const r = RARITY_RANK[defs.get(o.droidId)?.rarity ?? 'iconic']
  if (!r) return 0
  return data.constants.chipRateBase * r * tierRank(o.tier)
}

export interface ChipStatus {
  stations: number
  /** Effective chips per minute after all multipliers. */
  perMinute: number
  /** Raw station output per minute; storage caps apply to this. */
  basePerMinute: number
  /** Collection multiplier: companions, party, BB-8, event. */
  multiplier: number
  doubled: boolean // BB-8 companion doubles collection
  capacityHours: number
  /** Chips waiting in the stations now (capped). */
  stored: number
  /** Seconds until stations are full; 0 = full now. */
  fullIn: number
  balance: number
}

export function chipStatus(save: Save, data: GameData, defs: DefIndex, now = Date.now()): ChipStatus {
  const p = save.profile
  const stations = slotCounts(data, save).chipStations
  const doubled = save.droids.some((o) => o.droidId === 'bb-8' && o.location.kind === 'companion')
  let basePerMinute = 0
  for (const o of save.droids) {
    if (o.location.kind === 'chip' && o.location.station < stations) basePerMinute += stationRate(o, defs, data)
  }
  const multiplier = chipMultiplier({
    chipTraitCompanions: p.chipTraitCompanions ?? 0,
    partySize: p.partySize ?? 1,
    bb8: doubled,
    event: !!p.chipEvent,
  })
  const capacityHours = 1 + 0.5 * (p.nova['upgrade-chip-capacity'] ?? 0)
  const capMinutes = capacityHours * 60
  const since = p.chipsCollectedAt ? Math.max(0, (now - p.chipsCollectedAt) / 60000) : 0
  // Stations hold raw chips; the multipliers apply when you collect.
  const stored = basePerMinute * Math.min(since, capMinutes) * multiplier
  const fullIn = basePerMinute > 0 ? Math.max(0, capMinutes - since) * 60 : Number.POSITIVE_INFINITY
  return { stations, perMinute: basePerMinute * multiplier, basePerMinute, multiplier, doubled, capacityHours, stored, fullIn, balance: p.chips }
}

/**
 * Community-measured collection formula (Reddit chip station chart):
 *   chips = base × (100% + 100% per chip-trait companion [+ 100% during the 2× event]) × (1 + 0.2 × (party − 1)) × 2 with BB-8
 * The event is currently additive inside the first bracket, not a straight ×2.
 */
export function chipMultiplier(o: { chipTraitCompanions: number; partySize: number; bb8: boolean; event: boolean }): number {
  const companions = 1 + Math.max(0, Math.min(2, o.chipTraitCompanions)) + (o.event ? 1 : 0)
  const party = 1 + 0.2 * (Math.max(1, Math.min(6, o.partySize)) - 1)
  return companions * party * (o.bb8 ? 2 : 1)
}

/** Seconds until you can afford `chips`, counting your balance plus what's stored. */
export function chipEta(chips: number, s: ChipStatus): number {
  const have = s.balance + s.stored
  if (chips <= have) return 0
  return s.perMinute > 0 ? ((chips - have) / s.perMinute) * 60 : Number.POSITIVE_INFINITY
}

/** Total chips the upgrade suggestions in the needed queue would cost (cheapest upgrade per requirement). */
export function chipsNeeded(queue: NeededItem[], upToRebirth = Number.POSITIVE_INFINITY): number {
  let sum = 0
  for (const item of queue) {
    if (item.forRebirth > upToRebirth) continue
    const up = item.coverage.find((c) => c.kind === 'upgrade')
    if (up && up.kind === 'upgrade') sum += up.chips
  }
  return sum
}

export interface StationCandidate {
  uid: string
  perMinute: number
  /** Credits/s you'd lose by taking it out of its earning slot (0 if it isn't earning). */
  creditsLost: number
}

/** Owned non-Iconic droids ranked by chip rate, with the credit cost of moving each into a station. */
export function stationCandidates(save: Save, data: GameData, defs: DefIndex): StationCandidate[] {
  const inc = computeIncome(save, data, defs)
  const earning = new Map(inc.perDroid.map((x) => [x.uid, x.final * inc.factor]))
  return save.droids
    .map((o) => ({ uid: o.uid, perMinute: stationRate(o, defs, data), creditsLost: earning.get(o.uid) ?? 0 }))
    .filter((c) => c.perMinute > 0)
    .sort((a, b) => b.perMinute - a.perMinute || a.creditsLost - b.creditsLost)
}
