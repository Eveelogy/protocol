// Scourge scarcity helpers: Hive Mind what-ifs, Scourge Friday timing, super-rebirth loss.
import type { Save } from '../domain/save.ts'
import type { GameData } from '../domain/types.ts'
import { computeIncome } from './income.ts'
import type { DefIndex } from './requirements.ts'

/** Next Scourge Friday window; `active` when we're inside it now. */
export function scourgeWindow(data: GameData, now = Date.now()): { active: boolean; startsIn: number; endsIn: number } {
  const { weekdayUtc, startHourUtc, hours } = data.constants.scourgeFriday
  const week = 7 * 86400_000
  const dur = hours * 3600_000
  const d = new Date(now)
  // Most recent window start at or before now.
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), startHourUtc) - ((d.getUTCDay() - weekdayUtc + 7) % 7) * 86400_000
  if (start > now) start -= week
  if (now < start + dur) return { active: true, startsIn: 0, endsIn: (start + dur - now) / 1000 }
  return { active: false, startsIn: (start + week - now) / 1000, endsIn: 0 }
}

export interface WhatIfPoint {
  extra: number
  income: number
}

/**
 * "If I get N more Scourge droids": each extra Scourge replaces your weakest earning non-Scourge
 * droid with a Scourge copy of the same droid (same slot).
 */
export function scourgeWhatIf(save: Save, data: GameData, defs: DefIndex, maxExtra = 10): WhatIfPoint[] {
  const base = computeIncome(save, data, defs)
  const order = [...base.perDroid]
    .filter((x) => save.droids.find((o) => o.uid === x.uid)?.tier !== 'scourge')
    .sort((a, b) => a.final - b.final)
    .map((x) => x.uid)
  const pts: WhatIfPoint[] = [{ extra: 0, income: base.calibrated }]
  for (let n = 1; n <= Math.min(maxExtra, order.length); n++) {
    const swap = new Set(order.slice(0, n))
    const droids = save.droids.map((o) => (swap.has(o.uid) ? { ...o, tier: 'scourge' as const } : o))
    pts.push({ extra: n, income: computeIncome({ ...save, droids }, data, defs, droids).calibrated })
  }
  return pts
}

/** What a super rebirth would cost you in Scourge droids. */
export function scourgeLoss(save: Save, data: GameData, defs: DefIndex) {
  const owned = save.droids.filter((o) => o.tier === 'scourge')
  const inc = computeIncome(save, data, defs)
  const fromScourge = inc.perDroid
    .filter((x) => owned.some((o) => o.uid === x.uid))
    .reduce((s, x) => s + x.final * inc.factor, 0)
  return { count: owned.length, share: inc.calibrated > 0 ? fromScourge / inc.calibrated : 0 }
}
