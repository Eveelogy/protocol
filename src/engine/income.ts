// Income model. The formula is community-derived; calibration against real numbers corrects it.
import type { OwnedDroid, Save } from '../domain/save.ts'
import { type Area, type GameData, type Tier } from '../domain/types.ts'
import type { DefIndex } from './requirements.ts'

export interface DroidIncome {
  uid: string
  base: number // tier income × kyber colour
  final: number // after class match, multiplier, protocol bonus and hive mind
  hive: number // part of final that comes from Hive Mind
}

export interface IncomeBreakdown {
  perDroid: DroidIncome[]
  iconic: number
  total: number // predicted, before calibration
  calibrated: number
  factor: number
  hiveMembers: number
  primePlaced: boolean
}

export function tierIncome(defs: DefIndex, droidId: string, tier: Tier, kyber: OwnedDroid['kyber'], data: GameData): number {
  const def = defs.get(droidId)
  if (!def) return 0
  const base = def.income[tier] ?? 0
  if (tier === 'kyber' && kyber && kyber !== 'inactive') return base * data.constants.kyberMultiplier[kyber]
  return base
}

export function calibrationFactor(save: Save): number {
  const s = save.profile.calibration.filter((x) => x.predicted > 0 && x.actual > 0).slice(-5)
  if (!s.length) return 1
  const ratios = s.map((x) => x.actual / x.predicted).sort((a, b) => a - b)
  return ratios[Math.floor(ratios.length / 2)]
}

export function computeIncome(save: Save, data: GameData, defs: DefIndex, droids: OwnedDroid[] = save.droids): IncomeBreakdown {
  const c = data.constants
  const M = save.profile.multiplier || 1
  const hm = { ...c.hiveMind, ...save.profile.overrides.hiveMind }

  // Protocol bonus per area from droids in the "credits" protocol slots.
  const areaBonus: Record<Area, number> = { worker: 0, astromech: 0, battle: 0 }
  const primeAreas = new Set<Area>()
  let primePlaced = false
  for (const o of droids) {
    if (o.location.kind !== 'protocol') continue
    const loc = o.location
    const slot = c.protocolSlots.find((s) => s.id === loc.slotId)
    if (!slot || slot.kind !== 'credits') continue
    if (o.droidId === 'scourge-prime') {
      primePlaced = true
      primeAreas.add(slot.area)
    }
    areaBonus[slot.area] += defs.get(o.droidId)?.protocolBonus?.[o.tier] ?? 0
  }
  if (droids.some((o) => o.droidId === 'scourge-prime' && o.location.kind === 'slot')) primePlaced = true

  const hiveMembers = droids.filter(
    (o) => o.tier === 'scourge' && hm.countsLocations.includes(o.location.kind) && o.droidId !== 'scourge-prime',
  ).length
  const primeBonus = primePlaced ? hm.primeEffectiveMembers : 0

  const perDroid: DroidIncome[] = []
  for (const o of droids) {
    if (o.location.kind !== 'slot') continue
    const def = defs.get(o.droidId)
    if (!def || def.rarity === 'iconic') continue
    const area = o.location.area
    const base = tierIncome(defs, o.droidId, o.tier, o.kyber, data)
    const classMatch = def.class === area ? c.classMatchBonus : 1
    const regular = base * classMatch * M * (1 + areaBonus[area])
    let others = 0
    if (o.tier === 'scourge') others = hiveMembers - 1 + primeBonus
    else if (primeAreas.has(area)) others = hiveMembers + primeBonus // Prime in this area's protocol slot (experimental)
    const hive = others > 0 ? regular * hm.perOtherScourge * others : 0
    perDroid.push({ uid: o.uid, base, final: regular + hive, hive })
  }
  const nonIconic = perDroid.reduce((s, x) => s + x.final, 0)
  let iconic = 0
  for (const o of droids) {
    const def = defs.get(o.droidId)
    if (def?.rarity !== 'iconic' || !def.iconicShare) continue
    if (o.location.kind === 'slot' || (o.location.kind === 'protocol' && o.droidId === 'scourge-prime')) iconic += nonIconic * def.iconicShare
  }
  const total = nonIconic + iconic
  const factor = calibrationFactor(save)
  return { perDroid, iconic, total, calibrated: total * factor, factor, hiveMembers, primePlaced }
}

/** Seconds until `credits` is reached at `perSecond`, from `have`. */
export const secondsToCredits = (need: number, have: number, perSecond: number) =>
  need <= have ? 0 : perSecond > 0 ? (need - have) / perSecond : Number.POSITIVE_INFINITY
