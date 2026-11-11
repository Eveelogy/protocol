// Keeps a save consistent with game rules that the UI also enforces.
import type { Save } from '../domain/save.ts'
import type { DefIndex } from './requirements.ts'

const placeRank = (k: string) => (k === 'slot' || k === 'protocol' ? 0 : k === 'companion' ? 1 : k === 'lounge' ? 2 : 3)

/** Iconics have no tiers and you can own only one of each: reset their tier and drop duplicate copies. */
export function normalizeSave(save: Save, defs: DefIndex): Save {
  let changed = false
  const keep = new Map<string, string>() // iconic droidId -> uid kept
  const iconics = save.droids.filter((o) => defs.get(o.droidId)?.rarity === 'iconic')
  for (const o of [...iconics].sort((a, b) => placeRank(a.location.kind) - placeRank(b.location.kind))) {
    if (!keep.has(o.droidId)) keep.set(o.droidId, o.uid)
  }
  const droids = save.droids
    .filter((o) => {
      if (defs.get(o.droidId)?.rarity !== 'iconic') return true
      const ok = keep.get(o.droidId) === o.uid
      if (!ok) changed = true
      return ok
    })
    .map((o) => {
      if (defs.get(o.droidId)?.rarity !== 'iconic' || (o.tier === 'default' && !o.flawless && !o.kyber)) return o
      changed = true
      return { ...o, tier: 'default' as const, flawless: undefined, kyber: undefined }
    })
  const blueprints = save.blueprints.filter((b) => defs.get(b.droidId)?.rarity !== 'iconic')
  if (blueprints.length !== save.blueprints.length) changed = true
  return changed ? { ...save, droids, blueprints } : save
}
