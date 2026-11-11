import { describe, expect, it } from 'vitest'
import gameData from '../data/game-data.json'
import { type OwnedDroid, type Save, newSave } from '../domain/save.ts'
import type { GameData, Tier } from '../domain/types.ts'
import { cb23Entry, cb23ReadyIn, cb23Stats, suggestedMissionMinutes } from './cb23.ts'
import { chipEta, chipStatus, stationRate } from './chips.ts'
import { applyFusion, fusionSuggestions } from './fusion.ts'
import { indexDefs } from './requirements.ts'
import { scourgeLoss, scourgeWhatIf, scourgeWindow } from './scourge.ts'
import { recommendStop, superRebirthOptions } from './superPlan.ts'

const data = gameData as unknown as GameData
const defs = indexDefs(data)
let n = 0
const own = (droidId: string, tier: Tier, location: OwnedDroid['location'] = { kind: 'lounge' }): OwnedDroid => ({ uid: `f${n++}`, droidId, tier, location })
const saveWith = (droids: OwnedDroid[], p: Partial<Save['profile']> = {}): Save => {
  const s = newSave()
  s.droids = droids
  Object.assign(s.profile, p)
  return s
}
const slot = (i: number) => ({ kind: 'slot' as const, area: 'worker' as const, index: i })

describe('super rebirth payouts', () => {
  it('has crystals for rebirth 12–40', () => {
    expect(data.superRebirth.find((x) => x.level === 12)!.crystals).toBe(11)
    expect(data.superRebirth.find((x) => x.level === 40)!.crystals).toBe(529)
  })
  it('lists stopping points from rebirth 12 and flags luck', () => {
    const s = saveWith([own('gonk', 'gold', slot(0))], { rebirth: 12 })
    const opts = superRebirthOptions(s, data, defs, 0)
    expect(opts[0]).toMatchObject({ level: 12, crystals: 11, eta: 0, needsLuck: false })
    expect(opts.at(-1)!.level).toBe(40)
    expect(opts.at(-1)!.needsLuck).toBe(true)
    expect(recommendStop(opts)!.level).toBe(12)
  })
  it('uses crystals per hour over the run when the run start is known', () => {
    const s = saveWith([own('gonk', 'gold', slot(0))], { rebirth: 12, runStartedAt: -3600_000 })
    const opts = superRebirthOptions(s, data, defs, 0)
    expect(opts[0].perHour).toBeCloseTo(11)
  })
})

describe('chip stations', () => {
  it('rate = 2 × rarity rank × tier rank per minute', () => {
    expect(stationRate({ droidId: 'mouse', tier: 'default' }, defs, data)).toBe(2)
    expect(stationRate({ droidId: 'mouse', tier: 'kyber' }, defs, data)).toBe(16)
    expect(stationRate({ droidId: 'cb-23', tier: 'default' }, defs, data)).toBe(0)
  })
  it('counts only unlocked stations, caps storage and computes ETAs', () => {
    const s = saveWith([own('mouse', 'gold', { kind: 'chip', station: 0 }), own('gonk', 'gold', { kind: 'chip', station: 1 })], {
      nova: { 'upgrade-chip-station': 1 },
      chips: 10,
      chipsCollectedAt: 1, // 0 means "never collected"
    })
    const st = chipStatus(s, data, defs, 1 + 2 * 3600_000)
    expect(st.perMinute).toBe(4)
    expect(st.stored).toBe(4 * 60) // capped at 1 hour
    expect(st.fullIn).toBe(0)
    expect(chipEta(10 + 240 + 40, st)).toBeCloseTo(600)
  })
})

describe('fusion', () => {
  it('suggests 3 identical → next tier and applies it', () => {
    const s = saveWith([own('r9', 'gold'), own('r9', 'gold'), own('r9', 'gold')], { rebirth: 4 })
    const f = fusionSuggestions(s, data, defs)
    const tier = f.find((x) => x.kind === 'tier')!
    expect(tier.result).toEqual({ droidId: 'r9', tier: 'diamond' })
    expect(tier.helps).toContain(5)
    const after = applyFusion(s, tier, 'new')
    expect(after.droids).toHaveLength(1)
    expect(after.droids[0]).toMatchObject({ droidId: 'r9', tier: 'diamond' })
  })
  it('suggests fusion-exclusive droids at the lowest input tier', () => {
    const s = saveWith([own('mouse', 'gold'), own('mouse', 'rainbow'), own('arg', 'diamond')])
    const ex = fusionSuggestions(s, data, defs).find((x) => x.kind === 'exclusive')!
    expect(ex.result).toEqual({ droidId: 'whl-ex', tier: 'gold' })
  })
})

describe('scourge', () => {
  it('finds the Scourge Friday window in UTC', () => {
    const fri = Date.UTC(2026, 10, 13, 5) // Fri 13 Nov 2026 05:00 UTC
    expect(scourgeWindow(data, fri)).toMatchObject({ active: true })
    expect(scourgeWindow(data, fri).endsIn).toBe(22 * 3600)
    const thu = Date.UTC(2026, 10, 12, 3)
    expect(scourgeWindow(data, thu)).toMatchObject({ active: false, startsIn: 24 * 3600 })
    const sat = Date.UTC(2026, 10, 14, 4)
    expect(scourgeWindow(data, sat).startsIn).toBe((6 * 24 - 1) * 3600)
  })
  it('what-if income grows with more Scourge and loss counts them', () => {
    const s = saveWith([own('gonk', 'gold', slot(0)), own('mouse', 'gold', slot(1)), own('pit', 'scourge', slot(2))])
    const pts = scourgeWhatIf(s, data, defs)
    expect(pts[0].extra).toBe(0)
    expect(pts[2].income).toBeGreaterThan(pts[1].income)
    expect(scourgeLoss(s, data, defs).count).toBe(1)
  })
})

describe('cb-23 log', () => {
  it('gates by mission length, applies Hyperdrive, computes stats', () => {
    const s = saveWith([], { cb23MissionMinutes: 20, hyperdrive: true })
    s.cb23.push(cb23Entry(s, 'crystals40', '1.38.5', 0))
    expect(s.cb23[0].crystals).toBe(120)
    expect(cb23ReadyIn(s, 10 * 60_000)).toBe(600)
    for (let i = 1; i <= 9; i++) s.cb23.push(cb23Entry(s, 'chips', '1.38.5', i * 20 * 60_000))
    const st = cb23Stats(s.cb23, data)
    expect(st.rate).toBeCloseTo(0.1)
    expect(suggestedMissionMinutes(s.cb23)).toBe(20)
  })
})
