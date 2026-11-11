// CB-23 secret mission log: soft gate and drop-rate stats.
import type { Cb23Entry, Save } from '../domain/save.ts'
import type { GameData } from '../domain/types.ts'

export const missionSeconds = (save: Save) => save.profile.cb23MissionMinutes * 60 * (1 - save.profile.missionSpeedPct / 100)

/** Seconds until the next mission should be done (0 = ready). */
export function cb23ReadyIn(save: Save, now = Date.now()): number {
  const last = save.cb23.at(-1)
  if (!last) return 0
  return Math.max(0, (last.at + missionSeconds(save) * 1000 - now) / 1000)
}

export function cb23Stats(entries: Cb23Entry[], data: GameData) {
  const n = entries.length
  const crystalRuns = entries.filter((e) => e.reward !== 'chips').length
  const crystals = entries.reduce((s, e) => s + e.crystals, 0)
  const span = n > 1 ? (entries[n - 1].at - entries[0].at) / 86400_000 : 0
  return {
    n,
    crystalRuns,
    rate: n ? crystalRuns / n : 0,
    community: data.constants.cb23.communityCrystalRate,
    crystals,
    perDay: span >= 0.5 ? crystals / span : undefined,
  }
}

/** Median gap between consecutive logs, in minutes — a hint for the real mission length. */
export function suggestedMissionMinutes(entries: Cb23Entry[]): number | undefined {
  const gaps = entries
    .slice(1)
    .map((e, i) => (e.at - entries[i].at) / 60000)
    .filter((g) => g > 3 && g < 180)
    .sort((a, b) => a - b)
  if (gaps.length < 4) return undefined
  return Math.round(gaps[Math.floor(gaps.length / 4)]) // lower quartile ≈ back-to-back runs
}

export function cb23Entry(save: Save, reward: Cb23Entry['reward'], gameVersion: string, now = Date.now()): Cb23Entry {
  const base = reward === 'crystals40' ? 40 : reward === 'crystals80' ? 80 : 0
  const mult = save.profile.hyperdrive ? 3 : 1
  return { at: now, reward, crystals: base * mult, hyperdrive: save.profile.hyperdrive, rebirth: save.profile.rebirth, path: save.profile.path, gameVersion }
}
