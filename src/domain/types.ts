// Core domain types shared by the data pipeline, the engine and the UI.

export const TIERS = [
  'default',
  'gold',
  'diamond',
  'rainbow',
  'beskar',
  'galactic',
  'stellar',
  'kyber',
  'scourge',
] as const
export type Tier = (typeof TIERS)[number]

/** Tiers that can be reached by chip upgrades / tier fusion (Scourge cannot). */
export const UPGRADABLE_TIERS: readonly Tier[] = TIERS.filter((t) => t !== 'scourge')

export const TIER_LABEL: Record<Tier, string> = {
  default: 'Default',
  gold: 'Gold',
  diamond: 'Diamond',
  rainbow: 'Rainbow',
  beskar: 'Beskar',
  galactic: 'Galactic',
  stellar: 'Stellar',
  kyber: 'Kyber',
  scourge: 'Scourge',
}

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic', 'iconic'] as const
export type Rarity = (typeof RARITIES)[number]

export const CLASSES = ['worker', 'astromech', 'battle', 'protocol'] as const
export type DroidClass = (typeof CLASSES)[number]

/** Areas that hold earning slots. Protocol droids boost these areas from protocol slots. */
export const AREAS = ['worker', 'astromech', 'battle'] as const
export type Area = (typeof AREAS)[number]

export type KyberColor = 'inactive' | 'green' | 'blue' | 'purple'

export type LocationKind = 'slot' | 'protocol' | 'lounge' | 'chip' | 'companion' | 'storage'

export interface DroidDef {
  id: string
  name: string
  rarity: Rarity
  class: DroidClass
  /** Income per second at each tier, before multipliers. */
  income: Partial<Record<Tier, number>>
  /** Tiers whose income was derived (not read directly from a source). */
  derivedIncome?: Tier[]
  /** Base craft time in seconds per tier, before speed bonuses. */
  craftSeconds?: Partial<Record<Tier, number>>
  /** For fusion-exclusive droids: the three component droid ids. */
  fusionOf?: [string, string, string]
  /** Iconic droids: share of summed raw income of placed droids (e.g. 0.15). */
  iconicShare?: number
  /** Protocol droids: area bonus per tier (e.g. 0.08 at default). */
  protocolBonus?: Partial<Record<Tier, number>>
  /** True when key facts (rarity/class/income) are placeholders waiting for a supplement. */
  incomplete?: boolean
}

export interface RequirementDroid {
  droidId: string
  tier: Tier
}

export interface RebirthStep {
  path: number // 1..6
  /** Rebirth level you are at before performing this rebirth (0..39). */
  from: number
  credits: number
  droids: RequirementDroid[]
}

export interface RebirthUnlock {
  level: number // rebirth level reached
  creditMultiplier?: number // e.g. 0.45 for +45%
  baseUpgrade?: string // raw text, e.g. "Worker Slot"
  slots: Partial<Record<Area | 'lounge', number>> // slots added at this level
}

export interface NovaUpgradeDef {
  id: string
  name: string
  section: string
  /** Cost per level; length = max level (unlimited upgrades list known levels). */
  costs: number[]
  unlimited?: boolean
}

export interface ResetRules {
  rebirth: { keep: string[]; wipe: string[] }
  superRebirth: { keep: string[]; wipe: string[]; iconicReclaimCost: number }
}

export interface GameConstants {
  classMatchBonus: number
  hiveMind: { perOtherScourge: number; primeEffectiveMembers: number; countsLocations: string[] }
  kyberMultiplier: Record<Exclude<KyberColor, 'inactive'>, number>
  inactiveKyberOfStellar: number
  scourgeOfStellar: number
  /** Chip cost per upgrade step (default→gold first) by rarity. */
  chipCosts: Partial<Record<Rarity, number[]>>
  /** Chips per minute = chipRateBase × rarityRank × tierRank. */
  chipRateBase: number
  protocolSlots: { id: string; area: Area; kind: 'credits' | 'crafting'; unlockAt: number }[]
  initialSlots: Record<Area, number>
  requirementLocations: { list: LocationKind[] }
  lounge: { base: number; perRebirth: number[]; novaUpgradeId: string }
  superRebirth: { minRebirth: number; needsRarity: Rarity; needsTier: Tier }
  scourgeFriday: { weekdayUtc: number; startHourUtc: number; hours: number }
  cb23: { defaultMissionMinutes: number; communityCrystalRate: number; hyperdriveMultiplier: number }
}

export interface Dispute {
  key: string
  values: { value: unknown; source: string }[]
  chosen: string
}

export interface GameData {
  schema: 1
  builtAt: string
  gameVersion: string
  sources: { id: string; title: string; url: string; license?: string; revision?: number; fetchedAt?: string }[]
  droids: DroidDef[]
  rebirths: RebirthStep[]
  unlocks: RebirthUnlock[]
  nova: NovaUpgradeDef[]
  constants: GameConstants
  resetRules: ResetRules
  disputes: Dispute[]
  warnings: string[]
}

export const tierIndex = (t: Tier): number => TIERS.indexOf(t)

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
