// How many slots of each kind the player has, derived from progress + Nova levels (with overrides).
import type { Save } from '../domain/save.ts'
import { AREAS, type Area, type GameData } from '../domain/types.ts'

export interface SlotCounts {
  areas: Record<Area, number>
  lounge: number
  protocol: string[] // unlocked protocol slot ids
  chipStations: number
}

export function slotCounts(data: GameData, save: Save): SlotCounts {
  const { profile } = save
  const c = data.constants
  const areas = { ...c.initialSlots }
  for (const u of data.unlocks) {
    if (u.level > profile.rebirth) continue
    for (const a of AREAS) areas[a] += u.slots[a] ?? 0
  }
  const lounge =
    c.lounge.base + c.lounge.perRebirth.filter((lvl) => lvl <= profile.rebirth).length + (profile.nova[c.lounge.novaUpgradeId] ?? 0)
  const protocol = c.protocolSlots.filter((s) => s.unlockAt <= profile.rebirth).map((s) => s.id)
  const chipStations = Math.min(2, profile.nova['upgrade-chip-station'] ?? 0)

  // Your own corrections ("the game shows one more astromech slot at rebirth 13"), applied from that rebirth on.
  for (const f of profile.slotFixes ?? []) if (f.level <= profile.rebirth) areas[f.area] += f.delta
  for (const a of AREAS) areas[a] = Math.max(0, Math.min(c.maxSlots?.[a] ?? 99, areas[a]))

  const o = profile.overrides
  return {
    areas,
    lounge: o.slots?.lounge ?? lounge,
    protocol: o.protocolSlots ?? protocol,
    chipStations,
  }
}

/** Protocol slots that unlock exactly at `level` (for "slot unlocked" toasts). */
export function unlocksAt(data: GameData, level: number): string[] {
  const out: string[] = []
  const u = data.unlocks.find((x) => x.level === level)
  if (u?.baseUpgrade) out.push(u.baseUpgrade)
  for (const p of data.constants.protocolSlots) if (p.unlockAt === level) out.push(`Protocol slot: ${p.area} ${p.kind}`)
  if (data.constants.lounge.perRebirth.includes(level)) out.push('Lounge slot')
  return out
}
