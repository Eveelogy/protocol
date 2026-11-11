// "Grind more rebirths or super rebirth now?" — compares every stopping point in the current path.
import type { Save } from '../domain/save.ts'
import type { GameData } from '../domain/types.ts'
import { chipEta, chipStatus } from './chips.ts'
import { stepEtas } from './plan.ts'
import { type Coverage, type DefIndex, coverageOptions } from './requirements.ts'

export type CoverKind = 'place' | 'chips' | 'fuse' | 'craft' | 'luck'

export interface StopOption {
  level: number
  crystals: number
  permanentCredit: number
  /** Seconds from now until you can rebirth up to this level (credits, plus chips for upgrades). */
  eta: number
  /** Unmet droid requirements between now and this level, by the best way to cover each. */
  cover: Record<CoverKind, number>
  needsLuck: boolean
  chips: number
  /** Crystals per hour over the whole run (needs a known run start), else undefined. */
  perHour?: number
}

export function bestCover(c: Coverage[]): CoverKind {
  if (c.some((x) => x.kind === 'place')) return 'place'
  if (c.some((x) => x.kind === 'upgrade')) return 'chips'
  if (c.some((x) => (x.kind === 'fuseTier' && x.have >= 3) || (x.kind === 'fusionDroid' && x.components.every((k) => k.have)))) return 'fuse'
  if (c.some((x) => x.kind === 'craft')) return 'craft'
  return 'luck'
}

export function superRebirthOptions(save: Save, data: GameData, defs: DefIndex, now = Date.now()): StopOption[] {
  const p = save.profile
  const min = Math.max(p.rebirth, data.constants.superRebirth.minRebirth)
  const etas = stepEtas(save, data, defs, now)
  const chips = chipStatus(save, data, defs, now)
  const out: StopOption[] = []
  const cover: Record<CoverKind, number> = { place: 0, chips: 0, fuse: 0, craft: 0, luck: 0 }
  let chipSum = 0
  let craftMax = 0
  const seen = new Set<string>()
  for (let level = p.rebirth; level <= 40; level++) {
    if (level > p.rebirth) {
      const step = etas.find((e) => e.status.step.from === level - 1)
      if (!step) break
      for (const r of step.status.reqs) {
        if (r.metBy) continue
        const key = `${r.req.droidId}@${r.req.tier}`
        if (seen.has(key)) continue
        seen.add(key)
        const cov = coverageOptions(r.req, save, data, defs, now)
        const kind = bestCover(cov)
        cover[kind]++
        if (kind === 'chips') {
          const up = cov.find((x) => x.kind === 'upgrade')
          if (up?.kind === 'upgrade') chipSum += up.chips
        }
        if (kind === 'craft') {
          const cr = cov.find((x) => x.kind === 'craft')
          if (cr?.kind === 'craft') craftMax = Math.max(craftMax, cr.seconds)
        }
      }
    }
    if (level < min) continue
    const payout = data.superRebirth.find((s) => s.level === level)
    if (!payout) continue
    const creditEta = level === p.rebirth ? 0 : (etas.find((e) => e.status.step.from === level - 1)?.eta ?? Number.POSITIVE_INFINITY)
    const eta = Math.max(creditEta, chipEta(chipSum, chips), craftMax)
    const elapsed = p.runStartedAt ? (now - p.runStartedAt) / 1000 : undefined
    out.push({
      level,
      crystals: payout.crystals,
      permanentCredit: payout.creditMultiplier,
      eta,
      cover: { ...cover },
      needsLuck: cover.luck > 0,
      chips: chipSum,
      perHour: elapsed !== undefined && Number.isFinite(eta) ? payout.crystals / ((elapsed + eta) / 3600) : undefined,
    })
  }
  return out
}

/** Best stopping point that doesn't depend on luck: highest crystals/hour if the run start is known, else the furthest reachable. */
export function recommendStop(opts: StopOption[]): StopOption | undefined {
  const safe = opts.filter((o) => !o.needsLuck && Number.isFinite(o.eta))
  if (!safe.length) return undefined
  if (safe.every((o) => o.perHour !== undefined)) return safe.reduce((a, b) => (b.perHour! > a.perHour! ? b : a))
  return safe.at(-1)
}
