// Time-based planning: when will each upcoming rebirth be affordable, and what is needed by when.
import type { Save } from '../domain/save.ts'
import type { GameData, RequirementDroid } from '../domain/types.ts'
import { computeIncome, secondsToCredits } from './income.ts'
import { type Coverage, type DefIndex, type StepStatus, coverageOptions, pathOverview } from './requirements.ts'

export interface StepEta {
  status: StepStatus
  /** Seconds from now until this step's credits are affordable, assuming every earlier rebirth is done on time. */
  eta: number
}

/**
 * Credits reset each rebirth, and each rebirth raises the credit multiplier by that level's bonus,
 * so later steps earn faster. Uses calibrated income from the current base.
 */
export function stepEtas(save: Save, data: GameData, defs: DefIndex, now = Date.now()): StepEta[] {
  const steps = pathOverview(save, data, defs)
  const inc = computeIncome(save, data, defs).calibrated
  const M0 = save.profile.multiplier || 1
  const elapsed = save.profile.creditsUpdatedAt ? (now - save.profile.creditsUpdatedAt) / 1000 : 0
  let have = save.profile.credits + Math.max(0, elapsed) * inc
  let t = 0
  let M = M0
  const out: StepEta[] = []
  for (const status of steps) {
    const rate = inc * (M / M0)
    t += secondsToCredits(status.step.credits, have, rate)
    out.push({ status, eta: t })
    have = 0
    M += data.unlocks.find((u) => u.level === status.step.from + 1)?.creditMultiplier ?? 0
  }
  return out
}

export interface NeededItem {
  req: RequirementDroid
  forRebirth: number // the rebirth level this step reaches
  eta: number
  coverage: Coverage[]
}

/** Every unmet requirement in the path, earliest deadline first, deduplicated by droid+tier. */
export function neededQueue(save: Save, data: GameData, defs: DefIndex, now = Date.now()): NeededItem[] {
  const seen = new Set<string>()
  const out: NeededItem[] = []
  for (const { status, eta } of stepEtas(save, data, defs, now)) {
    for (const r of status.reqs) {
      if (r.metBy) continue
      const key = `${r.req.droidId}@${r.req.tier}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ req: r.req, forRebirth: status.step.from + 1, eta, coverage: coverageOptions(r.req, save, data, defs, now) })
    }
  }
  return out
}
