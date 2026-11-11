// State transitions for rebirth / super rebirth. Pure: returns a new Save.
import type { Save } from '../domain/save.ts'
import type { GameData } from '../domain/types.ts'
import type { DefIndex } from './requirements.ts'

const clone = <T>(x: T): T => structuredClone(x)

export function applyRebirth(save: Save, data: GameData, now = Date.now()): Save {
  const s = clone(save)
  const p = s.profile
  if (p.rebirth >= 40) return s
  const from = p.rebirth
  p.rebirth += 1
  p.lifetimeRebirths += 1
  p.credits = 0
  p.creditsUpdatedAt = now
  // Estimate the new in-game multiplier until the player re-enters it.
  p.multiplier += data.unlocks.find((u) => u.level === p.rebirth)?.creditMultiplier ?? 0
  s.history.push({ at: now, kind: 'rebirth', path: p.path, from, to: p.rebirth })
  return s
}

export function applySuperRebirth(save: Save, defs: DefIndex, now = Date.now()): Save {
  const s = clone(save)
  const p = s.profile
  const from = p.rebirth
  const iconics = new Set(p.reclaimable)
  for (const o of s.droids) if (defs.get(o.droidId)?.rarity === 'iconic') iconics.add(o.droidId)
  p.reclaimable = [...iconics]
  s.droids = []
  s.blueprints = []
  p.path = (p.path % 6) + 1
  p.rebirth = 0
  p.credits = 0
  p.creditsUpdatedAt = now
  p.superRebirthsTracked += 1
  // Multiplier changes (rebirth bonuses lost, crystal bonus gained); the UI asks the player to re-enter it.
  p.calibration = []
  s.history.push({ at: now, kind: 'superRebirth', path: p.path, from, to: 0 })
  return s
}

export function setRebirth(save: Save, rebirth: number, now = Date.now()): Save {
  const s = clone(save)
  const r = Math.max(0, Math.min(40, Math.round(rebirth)))
  s.history.push({ at: now, kind: 'setRebirth', path: s.profile.path, from: s.profile.rebirth, to: r })
  s.profile.rebirth = r
  return s
}
