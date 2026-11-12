import { describe, expect, it } from 'vitest'
import type { DroidDef, RebirthStep, RebirthUnlock } from '../domain/types.ts'
import { canon, mergeSources, vote } from './merge.ts'
import type { SourceData } from './sources/extract.ts'
import { literal, parseJs, findObjects, topLevelConsts } from './sources/literal.ts'

const src = (id: string, p: Partial<SourceData>): SourceData => ({ id, title: id, url: '', fetchedAt: '', droids: [], rebirths: [], slotUnlocks: [], warnings: [], ...p })
const gonk = (): DroidDef => ({ id: 'gonk', name: 'Gonk', rarity: 'common', class: 'worker', income: { stellar: 126 } })

describe('vote', () => {
  it('picks the majority and breaks ties by source priority', () => {
    expect(vote([{ value: 1, source: 'wiki' }, { value: 2, source: 'pagesdev' }, { value: 2, source: 'tycoontools' }])!.value).toBe(2)
    expect(vote([{ value: 1, source: 'tycoontools' }, { value: 2, source: 'wiki' }])!.value).toBe(2)
  })
})

describe('mergeSources', () => {
  it('lets two sites outvote the wiki and reports it', () => {
    const droids = new Map([['gonk', gonk()]])
    const m = mergeSources(droids, [], [], [
      src('pagesdev', { droids: [{ id: 'gonk', name: 'GONK', income: { stellar: 128 } }] }),
      src('tycoontools', { droids: [{ id: 'gonk', name: 'GONK', income: { stellar: 128 } }] }),
    ])
    expect(droids.get('gonk')!.income.stellar).toBe(128)
    expect(m.inconsistencies[0]).toContain('Gonk stellar income')
  })
  it('matches spelling variants like LO/L0 and J09/JO9', () => {
    expect(canon('l0')).toBe(canon('lo'))
    expect(canon('jo9-4mn')).toBe(canon('j09-4mn'))
    const droids = new Map<string, DroidDef>([['l0', { id: 'l0', name: 'L0', rarity: 'rare', class: 'worker', income: {} }]])
    const m = mergeSources(droids, [], [], [src('tycoontools', { droids: [{ id: 'lo', name: 'LO', income: { default: 9 } }] })])
    expect(droids.size).toBe(1)
    expect(droids.get('l0')!.income.default).toBe(9)
    expect(m.unmatched).toEqual([])
  })
  it('fixes rebirth requirements and slot unlocks by majority', () => {
    const step: RebirthStep = { path: 2, from: 16, credits: 130e9, droids: [{ droidId: 'b2-rp', tier: 'diamond' }, { droidId: 'a', tier: 'gold' }, { droidId: 'b', tier: 'gold' }] }
    const other = { path: 2, from: 16, credits: 130e9, droids: [{ droidId: 'r7', tier: 'diamond' as const }, { droidId: 'a', tier: 'gold' as const }, { droidId: 'b', tier: 'gold' as const }] }
    const unlock: RebirthUnlock = { level: 22, slots: { battle: 1 } }
    mergeSources(new Map(), [step], [unlock], [
      src('pagesdev', { rebirths: [other], slotUnlocks: [{ level: 22, areas: ['battle'] }] }),
      src('tycoontools', { rebirths: [other], slotUnlocks: [{ level: 22, areas: [] }] }),
    ])
    expect(step.droids[0].droidId).toBe('r7')
    expect(unlock.slots).toEqual({ battle: 1 })
  })
  it('adds a droid only when two sites list it', () => {
    const droids = new Map<string, DroidDef>()
    const d = { id: 'new-one', name: 'NEW-ONE', rarity: 'epic' as const, class: 'battle' as const, income: { default: 5 } }
    mergeSources(droids, [], [], [src('pagesdev', { droids: [d] })])
    expect(droids.size).toBe(0)
    mergeSources(droids, [], [], [src('pagesdev', { droids: [d] }), src('droidex', { droids: [d] })])
    expect(droids.get('new-one')).toMatchObject({ rarity: 'epic', class: 'battle' })
  })
})

describe('literal reader (never runs site code)', () => {
  it('reads enum references, minified booleans and wrapped arrays', () => {
    const ast = parseJs('const lt={COMMON:"COMMON"};var x=[{name:"PIT",rarity:lt.COMMON,ok:!0,n:-2,t:`a`}];var l={0:n(x)}')
    const c = topLevelConsts(ast)
    expect(findObjects(ast, ['name', 'rarity'], c)[0]).toEqual({ name: 'PIT', rarity: 'COMMON', ok: true, n: -2, t: 'a' })
    expect((literal(c.get('l'), c) as Record<string, unknown[]>)['0']).toHaveLength(1)
  })
  it('ignores anything that would need executing', () => {
    const ast = parseJs('var a={x:fetch("http://evil"),y:(()=>1)(),z:1+1,w:globalThis.y}')
    expect(literal(topLevelConsts(ast).get('a'))).toEqual({ x: 'http://evil', y: undefined, z: undefined, w: 'y' })
  })
})
