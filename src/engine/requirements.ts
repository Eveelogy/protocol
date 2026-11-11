// Rebirth requirement matching and "how could I cover this" analysis.
import type { OwnedDroid, Save } from '../domain/save.ts'
import { type DroidDef, type GameData, type RebirthStep, type RequirementDroid, type Tier, TIERS, tierIndex } from '../domain/types.ts'

export type DefIndex = Map<string, DroidDef>
export const indexDefs = (data: GameData): DefIndex => new Map(data.droids.map((d) => [d.id, d]))

/** Inactive Kyber only counts up to Stellar. */
export function effectiveTier(o: OwnedDroid): Tier {
  if (o.tier === 'kyber' && (o.kyber ?? 'inactive') === 'inactive') return 'stellar'
  return o.tier
}

export function countsForRequirements(o: OwnedDroid, data: GameData): boolean {
  return data.constants.requirementLocations.list.includes(o.location.kind)
}

const tierMeets = (have: Tier, need: Tier) => have === 'scourge' || tierIndex(have) >= tierIndex(need)

/** Does this owned droid satisfy the requirement (directly, as Scourge of the same droid, or via a fusion droid)? */
export function satisfies(o: OwnedDroid, req: RequirementDroid, defs: DefIndex): 'direct' | 'scourge' | 'fusion' | false {
  const t = effectiveTier(o)
  if (o.droidId === req.droidId) {
    if (t === 'scourge') return 'scourge'
    return tierMeets(t, req.tier) ? 'direct' : false
  }
  const def = defs.get(o.droidId)
  if (def?.fusionOf?.includes(req.droidId) && tierMeets(t, req.tier)) return 'fusion'
  return false
}

export interface ReqStatus {
  req: RequirementDroid
  metBy?: { uid: string; how: 'direct' | 'scourge' | 'fusion' }
}

export interface StepStatus {
  step: RebirthStep
  reqs: ReqStatus[]
  missing: number
}

export function stepStatus(step: RebirthStep, save: Save, data: GameData, defs: DefIndex): StepStatus {
  const counted = save.droids.filter((o) => countsForRequirements(o, data))
  const reqs = step.droids.map((req): ReqStatus => {
    // Prefer a direct match so fusion/scourge copies stay "spare" in the UI.
    let best: ReqStatus['metBy']
    for (const o of counted) {
      const how = satisfies(o, req, defs)
      if (!how) continue
      if (how === 'direct') return { req, metBy: { uid: o.uid, how } }
      best ??= { uid: o.uid, how }
    }
    return { req, metBy: best }
  })
  return { step, reqs, missing: reqs.filter((r) => !r.metBy).length }
}

/** All remaining steps of the current path, from the player's current rebirth to 40. */
export function pathOverview(save: Save, data: GameData, defs = indexDefs(data)): StepStatus[] {
  return data.rebirths
    .filter((s) => s.path === save.profile.path && s.from >= save.profile.rebirth)
    .sort((a, b) => a.from - b.from)
    .map((s) => stepStatus(s, save, data, defs))
}

// ---------------------------------------------------------------- coverage options

export type Coverage =
  | { kind: 'place'; uid: string; note: string }
  | { kind: 'upgrade'; uid: string; fromTier: Tier; chips: number; activateKyber: boolean }
  | { kind: 'fuseTier'; have: number; fromTier: Tier }
  | { kind: 'fusionDroid'; droidId: string; components: { droidId: string; have: boolean }[] }
  | { kind: 'craft'; blueprintUid: string; seconds: number; inProgress: boolean }
  | { kind: 'luck' }

export function chipCost(def: DroidDef, from: Tier, to: Tier, data: GameData): number | undefined {
  const table = data.constants.chipCosts[def.rarity]
  if (!table) return undefined
  const a = tierIndex(from)
  const b = Math.min(tierIndex(to), tierIndex('kyber'))
  let sum = 0
  for (let i = a; i < b; i++) {
    if (table[i] === undefined) return undefined
    sum += table[i]
  }
  return sum
}

export function craftSeconds(def: DroidDef | undefined, tier: Tier, save: Save): number | undefined {
  const base = def?.craftSeconds?.[tier]
  if (base === undefined) return undefined
  return base / (1 + save.profile.craftSpeedPct / 100)
}

export function coverageOptions(req: RequirementDroid, save: Save, data: GameData, defs: DefIndex, now = Date.now()): Coverage[] {
  const out: Coverage[] = []
  const def = defs.get(req.droidId)
  const target = tierIndex(req.tier)

  // Owned but not in a counting location (e.g. storage/companion)
  for (const o of save.droids) {
    if (!countsForRequirements(o, data) && satisfies(o, req, defs))
      out.push({ kind: 'place', uid: o.uid, note: `It's in ${o.location.kind}; move it to the base or Lounge` })
  }

  // Chip upgrade of a lower copy (Iconics can't be upgraded; nothing upgrades into Scourge)
  if (def && def.rarity !== 'iconic' && req.tier !== 'scourge') {
    const lower = save.droids
      .filter((o) => o.droidId === req.droidId && o.tier !== 'scourge')
      .filter((o) => tierIndex(effectiveTier(o)) < target || (req.tier === 'kyber' && o.tier === 'kyber'))
      .sort((a, b) => tierIndex(b.tier) - tierIndex(a.tier))
    const best = lower[0]
    if (best) {
      if (best.tier === 'kyber') out.push({ kind: 'upgrade', uid: best.uid, fromTier: best.tier, chips: 0, activateKyber: true })
      else {
        const chips = chipCost(def, best.tier, req.tier, data)
        if (chips !== undefined)
          out.push({ kind: 'upgrade', uid: best.uid, fromTier: best.tier, chips, activateKyber: req.tier === 'kyber' })
      }
    }
  }

  // Tier fusion: 3 identical droids one tier below
  if (target > 0 && req.tier !== 'scourge' && def?.rarity !== 'iconic') {
    const fromTier = TIERS[target - 1]
    const have = save.droids.filter((o) => o.droidId === req.droidId && o.tier === fromTier).length
    if (have > 0) out.push({ kind: 'fuseTier', have: Math.min(have, 3), fromTier })
  }

  // Fusion-exclusive droids that contain this droid
  for (const fd of data.droids) {
    if (!fd.fusionOf?.includes(req.droidId)) continue
    const used = new Set<string>()
    const components = fd.fusionOf.map((cid) => {
      const o = save.droids.find((x) => x.droidId === cid && !used.has(x.uid) && tierMeets(effectiveTier(x), req.tier))
      if (o) used.add(o.uid)
      return { droidId: cid, have: !!o }
    })
    // Only worth mentioning once you own at least one other part (the required droid itself is the one missing).
    if (components.filter((x) => x.have).length >= 1) out.push({ kind: 'fusionDroid', droidId: fd.id, components })
  }

  // Craft from a blueprint you hold
  for (const b of save.blueprints) {
    if (b.droidId !== req.droidId || !tierMeets(b.tier, req.tier)) continue
    if (b.crafting) {
      const left = Math.max(0, b.crafting.startedAt + b.crafting.seconds * 1000 - now) / 1000
      out.push({ kind: 'craft', blueprintUid: b.uid, seconds: left, inProgress: true })
    } else {
      const s = craftSeconds(def, b.tier, save)
      if (s !== undefined) out.push({ kind: 'craft', blueprintUid: b.uid, seconds: s, inProgress: false })
    }
  }

  const actionable = out.some(
    (c) =>
      c.kind === 'place' ||
      c.kind === 'upgrade' ||
      c.kind === 'craft' ||
      (c.kind === 'fuseTier' && c.have >= 3) ||
      (c.kind === 'fusionDroid' && c.components.every((x) => x.have)),
  )
  if (!actionable) out.push({ kind: 'luck' })
  return out
}

/** Super rebirth needs rebirth ≥ N and a Legendary at Rainbow+ in a counting location. */
export function superRebirthEligibility(save: Save, data: GameData, defs = indexDefs(data)) {
  const sr = data.constants.superRebirth
  const rebirthOk = save.profile.rebirth >= sr.minRebirth
  const droidOk = save.droids.some((o) => {
    const d = defs.get(o.droidId)
    return d?.rarity === sr.needsRarity && countsForRequirements(o, data) && tierMeets(effectiveTier(o), sr.needsTier)
  })
  return { ok: rebirthOk && droidOk, rebirthOk, droidOk }
}
