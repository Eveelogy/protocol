import { describe, expect, it } from 'vitest'
import gameData from '../data/game-data.json'
import { type OwnedDroid, type Save, newSave } from '../domain/save.ts'
import type { GameData, Tier } from '../domain/types.ts'
import { formatAmount, formatDuration, parseAmountInput } from './format.ts'
import { computeIncome } from './income.ts'
import { stepEtas, neededQueue } from './plan.ts'
import { applyRebirth, applySuperRebirth } from './progress.ts'
import { chipCost, coverageOptions, indexDefs, pathOverview, satisfies, superRebirthEligibility } from './requirements.ts'
import { slotCounts } from './slots.ts'

const data = gameData as unknown as GameData
const defs = indexDefs(data)
let n = 0
const own = (droidId: string, tier: Tier, location: OwnedDroid['location'] = { kind: 'lounge' }, extra: Partial<OwnedDroid> = {}): OwnedDroid => ({
  uid: `u${n++}`,
  droidId,
  tier,
  location,
  ...extra,
})
const saveWith = (droids: OwnedDroid[], p: Partial<Save['profile']> = {}): Save => {
  const s = newSave()
  s.droids = droids
  Object.assign(s.profile, p)
  return s
}

describe('game data', () => {
  it('has 6 paths × 40 rebirths with 3 known droids each', () => {
    expect(data.rebirths).toHaveLength(240)
    for (const s of data.rebirths) {
      expect(s.droids).toHaveLength(3)
      for (const r of s.droids) expect(defs.has(r.droidId)).toBe(true)
      expect(s.credits).toBeGreaterThan(0)
    }
  })
  it('matches known wiki values', () => {
    const r5 = data.rebirths.find((s) => s.path === 1 && s.from === 4)!
    expect(r5.credits).toBe(5.35e6)
    expect(r5.droids).toEqual([
      { droidId: 'b-u4d', tier: 'gold' },
      { droidId: 'hov-r', tier: 'gold' },
      { droidId: 'r9', tier: 'diamond' },
    ])
    expect(data.rebirths.find((s) => s.path === 1 && s.from === 39)!.credits).toBe(15e15)
    expect(defs.get('gonk')!.income.gold).toBe(8)
    expect(defs.get('riv-3t')!.fusionOf).toEqual(['ric', 'ig', 'kx'])
  })
  it('reads Iconics from their wiki pages', () => {
    for (const id of ['dj-r-3x', 'mister-bones', 'ig-11-marshal', 'chopper', 'd-o', 'wg-22', 'cb-23', 'scourge-prime']) {
      expect(defs.get(id), id).toMatchObject({ rarity: 'iconic', iconicShare: 0.15 })
    }
    expect(defs.get('r2-d2')!.iconicShare).toBe(0.25)
    expect(defs.get('chopper')!.class).toBe('astromech')
    expect(defs.get('mph')).toMatchObject({ rarity: 'epic', class: 'astromech' })
  })
})

describe('requirements', () => {
  const req = { droidId: 'r9', tier: 'gold' as Tier }
  it('higher tier satisfies lower', () => {
    expect(satisfies(own('r9', 'diamond'), req, defs)).toBe('direct')
    expect(satisfies(own('r9', 'default'), req, defs)).toBe(false)
  })
  it('Scourge of the same droid satisfies any tier, but not other droids', () => {
    expect(satisfies(own('r9', 'scourge'), { droidId: 'r9', tier: 'kyber' }, defs)).toBe('scourge')
    expect(satisfies(own('gonk', 'scourge'), req, defs)).toBe(false)
  })
  it('inactive Kyber does not satisfy a Kyber requirement, active does', () => {
    const k = { droidId: 'gonk', tier: 'kyber' as Tier }
    expect(satisfies(own('gonk', 'kyber', undefined, { kyber: 'inactive' }), k, defs)).toBe(false)
    expect(satisfies(own('gonk', 'kyber', undefined, { kyber: 'green' }), k, defs)).toBe('direct')
    expect(satisfies(own('gonk', 'kyber', undefined, { kyber: 'inactive' }), { droidId: 'gonk', tier: 'stellar' }, defs)).toBe('direct')
  })
  it('fusion droids satisfy their components at their tier', () => {
    expect(satisfies(own('riv-3t', 'gold'), { droidId: 'kx', tier: 'gold' }, defs)).toBe('fusion')
    expect(satisfies(own('riv-3t', 'gold'), { droidId: 'kx', tier: 'diamond' }, defs)).toBe(false)
  })
  it('droids in storage do not count, but are offered as "place"', () => {
    const s = saveWith([own('r9', 'gold', { kind: 'storage' })])
    const step = pathOverview(s, data).find((x) => x.step.from === 2)!
    expect(step.reqs.find((r) => r.req.droidId === 'r9')!.metBy).toBeUndefined()
    expect(coverageOptions({ droidId: 'r9', tier: 'gold' }, s, data, defs)[0].kind).toBe('place')
  })
  it('path overview lists every remaining step and counts missing', () => {
    const s = saveWith([own('cb', 'default'), own('pit', 'default'), own('drk-1-probe', 'gold')])
    const ov = pathOverview(s, data)
    expect(ov).toHaveLength(40)
    expect(ov[0].missing).toBe(0)
    expect(ov[1].missing).toBe(3)
  })
  it('suggests chip upgrades with summed costs', () => {
    const r9 = defs.get('r9')!
    expect(chipCost(r9, 'default', 'diamond', data)).toBe((data.constants.chipCosts[r9.rarity]![0]) + data.constants.chipCosts[r9.rarity]![1])
    const s = saveWith([own('r9', 'default')])
    const cov = coverageOptions({ droidId: 'r9', tier: 'diamond' }, s, data, defs)
    expect(cov.find((c) => c.kind === 'upgrade')).toMatchObject({ fromTier: 'default' })
    expect(cov.some((c) => c.kind === 'luck')).toBe(false)
  })
  it('falls back to luck when nothing can cover it', () => {
    const cov = coverageOptions({ droidId: 'r9', tier: 'diamond' }, saveWith([]), data, defs)
    expect(cov.at(-1)!.kind).toBe('luck')
  })
  it('super rebirth eligibility needs rebirth 12 and a Legendary Rainbow+', () => {
    const leg = data.droids.find((d) => d.rarity === 'legendary')!
    expect(superRebirthEligibility(saveWith([own(leg.id, 'rainbow')], { rebirth: 12 }), data).ok).toBe(true)
    expect(superRebirthEligibility(saveWith([own(leg.id, 'diamond')], { rebirth: 12 }), data).ok).toBe(false)
    expect(superRebirthEligibility(saveWith([own(leg.id, 'rainbow')], { rebirth: 11 }), data).ok).toBe(false)
  })
})

describe('income', () => {
  it('applies class match, multiplier and protocol bonus', () => {
    const s = saveWith(
      [own('gonk', 'gold', { kind: 'slot', area: 'worker', index: 0 }), own('sa-5', 'default', { kind: 'protocol', slotId: 'worker-credits' })],
      { multiplier: 2 },
    )
    const inc = computeIncome(s, data, defs)
    expect(inc.total).toBeCloseTo(8 * 1.1 * 2 * 1.08)
  })
  it('lounge droids earn nothing', () => {
    expect(computeIncome(saveWith([own('gonk', 'gold')]), data, defs).total).toBe(0)
  })
  it('Hive Mind adds a share per other placed Scourge', () => {
    const slot = (i: number) => ({ kind: 'slot' as const, area: 'worker' as const, index: i })
    const s = saveWith([own('gonk', 'scourge', slot(0)), own('mouse', 'scourge', slot(1))])
    const inc = computeIncome(s, data, defs)
    const g = defs.get('gonk')!.income.scourge! * 1.1
    const m = defs.get('mouse')!.income.scourge! * 1.1
    expect(inc.total).toBeCloseTo((g + m) * (1 + data.constants.hiveMind.perOtherScourge))
  })
  it('calibration uses the median actual/predicted ratio', () => {
    const s = saveWith([own('gonk', 'gold', { kind: 'slot', area: 'worker', index: 0 })], {
      calibration: [
        { at: 1, predicted: 10, actual: 12 },
        { at: 2, predicted: 10, actual: 11 },
        { at: 3, predicted: 10, actual: 30 },
      ],
    })
    expect(computeIncome(s, data, defs).factor).toBeCloseTo(1.2)
  })
})

describe('planning', () => {
  it('ETAs accumulate per step and include the multiplier growth', () => {
    const s = saveWith([own('gonk', 'gold', { kind: 'slot', area: 'worker', index: 0 })], { rebirth: 0, credits: 0 })
    const e = stepEtas(s, data, defs, 0)
    const rate = 8 * 1.1
    expect(e[0].eta).toBeCloseTo(10_000 / rate)
    expect(e[1].eta).toBeCloseTo(10_000 / rate + 150_000 / (rate * (1 + 0.45)))
  })
  it('needed queue is sorted by deadline and deduplicated', () => {
    const q = neededQueue(saveWith([]), data, defs, 0)
    const keys = q.map((x) => `${x.req.droidId}@${x.req.tier}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(q[0].forRebirth).toBe(1)
  })
})

describe('progress', () => {
  it('rebirth resets credits, keeps droids and bumps counts', () => {
    const s = applyRebirth(saveWith([own('gonk', 'gold')], { rebirth: 3, lifetimeRebirths: 50, credits: 9e9 }), data, 0)
    expect(s.profile).toMatchObject({ rebirth: 4, lifetimeRebirths: 51, credits: 0 })
    expect(s.droids).toHaveLength(1)
  })
  it('super rebirth wipes droids, advances the path and marks iconics reclaimable', () => {
    const s = applySuperRebirth(saveWith([own('gonk', 'gold'), own('cb-23', 'default')], { path: 6, rebirth: 30 }), defs, 0)
    expect(s.profile).toMatchObject({ path: 1, rebirth: 0, superRebirthsTracked: 1 })
    expect(s.droids).toHaveLength(0)
    expect(s.profile.reclaimable).toContain('cb-23')
  })
})

describe('slots', () => {
  it('reaches the in-game maximum of 11 worker, 9 astromech and 11 battle slots', () => {
    expect(slotCounts(data, saveWith([], { rebirth: 40 })).areas).toEqual({ worker: 11, astromech: 9, battle: 11 })
    expect(slotCounts(data, saveWith([], { rebirth: 0 })).areas).toEqual(data.constants.initialSlots)
  })
  it('derives protocol and lounge slots from rebirth and Nova', () => {
    const s = saveWith([], { rebirth: 18, nova: { 'lounge-slot': 3 } })
    const c = slotCounts(data, s)
    expect(c.protocol).toEqual(['worker-credits', 'astromech-credits', 'battle-credits', 'worker-crafting', 'astromech-crafting'])
    expect(c.lounge).toBe(5 + 2 + 3)
  })
})

describe('format', () => {
  it('formats and parses amounts', () => {
    expect(formatAmount(5.35e6)).toBe('5.35M')
    expect(formatAmount(15e15)).toBe('15Qa')
    expect(formatAmount(220e6)).toBe('220M')
    expect(formatAmount(550e6)).toBe('550M')
    expect(formatAmount(100)).toBe('100')
    expect(formatAmount(2.5e12)).toBe('2.5T')
    expect(parseAmountInput('1.2qa')).toBe(1.2e15)
    expect(formatDuration(7800)).toBe('2h 10m')
  })
})
