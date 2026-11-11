// The player's saved state. Everything the app knows about *your* game lives here.
import type { Area, KyberColor, Tier } from './types.ts'

export type Location =
  | { kind: 'slot'; area: Area; index: number }
  | { kind: 'protocol'; slotId: string }
  | { kind: 'lounge' }
  | { kind: 'chip'; station: number }
  | { kind: 'companion' }
  | { kind: 'storage' }

export interface OwnedDroid {
  uid: string
  droidId: string
  tier: Tier
  flawless?: boolean
  /** Only meaningful when tier === 'kyber'. Inactive Kyber does not count for requirements. */
  kyber?: KyberColor
  location: Location
}

export interface Blueprint {
  uid: string
  droidId: string
  tier: Tier
  /** Set while it is being crafted. */
  crafting?: { startedAt: number; seconds: number }
}

export interface CalibrationSample {
  at: number
  predicted: number
  actual: number
}

export interface Cb23Entry {
  at: number
  reward: 'chips' | 'crystals40' | 'crystals80'
  crystals: number
  hyperdrive: boolean
  rebirth: number
  path: number
  gameVersion: string
}

export interface HistoryEntry {
  at: number
  kind: 'rebirth' | 'superRebirth' | 'setRebirth'
  path: number
  from: number
  to: number
}

export interface Profile {
  path: number
  rebirth: number
  lifetimeRebirths: number
  /** Super rebirths done before tracking started; null = unknown. */
  superRebirthsBefore: number | null
  superRebirthsTracked: number
  /** The in-game green credit multiplier number. */
  multiplier: number
  calibration: CalibrationSample[]
  credits: number
  creditsUpdatedAt: number
  /** Nova Shop upgrade levels by upgrade id. */
  nova: Record<string, number>
  craftSpeedPct: number
  hyperdrive: boolean
  cb23MissionMinutes: number
  missionSpeedPct: number
  /** Iconic droid ids you owned before a super rebirth and can reclaim (1M credits each). */
  reclaimable: string[]
  /** Manual overrides for derived unlock values. */
  overrides: { slots?: Partial<Record<Area | 'lounge', number>>; protocolSlots?: string[]; hiveMind?: { perOtherScourge?: number; primeEffectiveMembers?: number } }
  ui: { retro: 'clean' | 'terminal' }
}

export interface Save {
  version: 1
  setupDone: boolean
  profile: Profile
  droids: OwnedDroid[]
  blueprints: Blueprint[]
  history: HistoryEntry[]
  cb23: Cb23Entry[]
  seenDataBuild?: string
}

export const newSave = (): Save => ({
  version: 1,
  setupDone: false,
  profile: {
    path: 1,
    rebirth: 0,
    lifetimeRebirths: 0,
    superRebirthsBefore: null,
    superRebirthsTracked: 0,
    multiplier: 1,
    calibration: [],
    credits: 0,
    creditsUpdatedAt: 0,
    nova: {},
    craftSpeedPct: 0,
    hyperdrive: false,
    cb23MissionMinutes: 20,
    missionSpeedPct: 0,
    reclaimable: [],
    overrides: {},
    ui: { retro: 'terminal' },
  },
  droids: [],
  blueprints: [],
  history: [],
  cb23: [],
})

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
