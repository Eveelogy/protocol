// Extractors for community fan sites. Each turns a site's shipped data into plain facts.
// Nothing here executes the sites' code: see literal.ts.
import { type DroidClass, type Rarity, type Tier, slugify } from '../../domain/types.ts'
import { findDeclaration, findObjects, parseJs, topLevelConsts } from './literal.ts'

export interface SourceDroid {
  id: string
  name: string
  rarity?: Rarity
  class?: DroidClass
  income: Partial<Record<Tier, number>>
  craftSeconds?: Partial<Record<Tier, number>>
}

export interface SourceRebirth {
  path: number
  from: number
  credits?: number
  droids: { droidId: string; tier: Tier }[]
}

export interface SourceData {
  id: string
  title: string
  url: string
  fetchedAt: string
  droids: SourceDroid[]
  rebirths: SourceRebirth[]
  /** Earning-slot unlocks by rebirth level reached. */
  slotUnlocks: { level: number; areas: ('worker' | 'astromech' | 'battle' | 'lounge')[] }[]
  warnings: string[]
}

const TIER: Record<string, Tier> = {
  DEFAULT: 'default',
  BASE: 'default',
  BASIC: 'default',
  GOLD: 'gold',
  DIAMOND: 'diamond',
  RAINBOW: 'rainbow',
  BESKAR: 'beskar',
  GALACTIC: 'galactic',
  STELLAR: 'stellar',
  KYBER: 'kyber',
  SCOURGE: 'scourge',
}
const tierOf = (s: unknown): Tier | undefined => TIER[String(s ?? '').toUpperCase()]
const rarityOf = (s: unknown): Rarity | undefined => {
  const r = String(s ?? '').toLowerCase()
  return (['common', 'rare', 'epic', 'legendary', 'mythic', 'iconic'] as const).find((x) => x === r)
}
const classOf = (s: unknown): DroidClass | undefined => {
  const c = String(s ?? '').toLowerCase()
  return (['worker', 'astromech', 'battle', 'protocol'] as const).find((x) => x === c)
}
const areaOf = (s: unknown) => {
  const a = String(s ?? '').toLowerCase()
  return (['worker', 'astromech', 'battle', 'lounge'] as const).find((x) => a.startsWith(x))
}
/** "BDX EXPLORER" → "bdx-explorer"; matches our wiki-based ids. */
export const idOf = (name: string) => slugify(name.toLowerCase())
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)

// ---------------------------------------------------------------- droid-tycoon.pages.dev

/** `droidsJs` and `rebirthJs` are that site's droid and rebirth chunks. */
export function fromPagesDev(droidsJs: string, rebirthJs: string, meta: { url: string; fetchedAt: string }): SourceData {
  const warnings: string[] = []
  const dAst = parseJs(droidsJs)
  const dConsts = topLevelConsts(dAst)
  // Tier multiplier table: { DEFAULT: { COMMON: { income, craftingTime } }, GOLD: … }
  const mult = obj(findDeclaration(dAst, (v) => !!obj(v)?.DEFAULT && !!obj(v)?.GOLD && !!obj(obj(v)?.GOLD)?.COMMON, dConsts))
  const droids: SourceDroid[] = []
  for (const d of findObjects(dAst, ['name', 'rarity', 'type', 'variants'], dConsts)) {
    const name = String(d.name)
    const rarity = rarityOf(d.rarity)
    const variants = obj(d.variants) ?? {}
    const base = obj(variants.DEFAULT)
    const income: SourceDroid['income'] = {}
    const craft: NonNullable<SourceDroid['craftSeconds']> = {}
    for (const [T, tier] of Object.entries(TIER)) {
      if (T === 'BASE' || T === 'BASIC') continue
      const v = obj(variants[T])
      const m = obj(obj(mult?.[T])?.[String(d.rarity)])
      const inc = num(v?.income) ?? (base && m && num(base.income) !== undefined && num(m.income) !== undefined ? num(base.income)! * num(m.income)! : undefined)
      const ct = num(v?.craftingTime) ?? (base && m && num(base.craftingTime) !== undefined && num(m.craftingTime) !== undefined ? num(base.craftingTime)! * num(m.craftingTime)! : undefined)
      if (inc !== undefined) income[tier] = inc
      if (ct !== undefined) craft[tier] = ct
    }
    droids.push({ id: idOf(name), name, rarity, class: classOf(d.type), income, craftSeconds: craft })
  }
  if (!mult) warnings.push('pages.dev: tier multiplier table not found; only listed variants used')

  const rAst = parseJs(rebirthJs)
  const rConsts = topLevelConsts(rAst)
  const rebirths: SourceRebirth[] = []
  const byPath = obj(
    findDeclaration(
      rAst,
      (v) => {
        const o = obj(v)
        const keys = Object.keys(o ?? {})
        return !!o && keys.length === 6 && keys.every((k) => Array.isArray(o[k]) && (o[k] as unknown[]).some((s) => !!obj(s)?.requiredDroids))
      },
      rConsts,
    ),
  )
  const levels = findObjects(rAst, ['creditsCost', 'newSlotType'], rConsts)
  const pathKeys = Object.keys(byPath ?? {}).map(Number)
  const pathOffset = pathKeys.includes(0) ? 1 : 0 // the site numbers paths 0–5
  for (const [p, steps] of Object.entries(byPath ?? {})) {
    for (const s of steps as Record<string, unknown>[]) {
      const from = num(s.from)
      if (from === undefined) continue
      const reqs = ((s.requiredDroids as Record<string, unknown>[]) ?? [])
        .map((r) => ({ droidId: idOf(String(r.droidName ?? '')), tier: tierOf(r.variant) }))
        .filter((r): r is { droidId: string; tier: Tier } => !!r.droidId && !!r.tier)
      rebirths.push({ path: Number(p) + pathOffset, from, credits: num(levels[from]?.creditsCost), droids: reqs })
    }
  }
  if (!byPath) warnings.push('pages.dev: rebirth paths not found')
  const slotUnlocks = levels.map((l, i) => ({
    level: i + 1,
    areas: ((l.newSlotType as unknown[]) ?? []).map(areaOf).filter((a): a is NonNullable<typeof a> => !!a),
  }))
  return { id: 'pagesdev', title: 'droid-tycoon.pages.dev', url: meta.url, fetchedAt: meta.fetchedAt, droids, rebirths, slotUnlocks, warnings }
}

// ---------------------------------------------------------------- tycoon-tools.com

/** `html` is the tracker page, which inlines `const DATA = {…}`. */
export function fromTycoonTools(html: string, meta: { url: string; fetchedAt: string }): SourceData {
  const warnings: string[] = []
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((s) => s.includes('const DATA'))
  let data: Record<string, unknown> | undefined
  for (const s of scripts) {
    try {
      const ast = parseJs(s)
      data = obj(findDeclaration(ast, (v) => !!obj(v)?.cycles && !!obj(v)?.econ))
      if (data) break
    } catch (e) {
      warnings.push(`tycoon-tools: script parse failed (${(e as Error).message})`)
    }
  }
  if (!data) return { id: 'tycoontools', title: 'tycoon-tools.com', url: meta.url, fetchedAt: meta.fetchedAt, droids: [], rebirths: [], slotUnlocks: [], warnings: [...warnings, 'tycoon-tools: DATA not found'] }

  const droids: SourceDroid[] = []
  for (const [name, e] of Object.entries(obj(data.econ) ?? {})) {
    const o = obj(e)
    const income: SourceDroid['income'] = {}
    for (const [T, v] of Object.entries(obj(o?.tiers) ?? {})) {
      const t = tierOf(T)
      const inc = num(obj(v)?.income)
      if (t && inc !== undefined) income[t] = inc
    }
    droids.push({ id: idOf(name), name, rarity: rarityOf(o?.rarity), class: classOf(o?.type), income })
  }
  const rebirths: SourceRebirth[] = []
  const slotUnlocks: SourceData['slotUnlocks'] = []
  for (const c of (data.cycles as Record<string, unknown>[]) ?? []) {
    const path = num(c.id)
    for (const s of (c.steps as Record<string, unknown>[]) ?? []) {
      const m = String(s.step ?? '').match(/(\d+)\s*->\s*(\d+)/)
      if (!path || !m) continue
      const from = Number(m[1])
      const reqs = ((s.reqs as Record<string, unknown>[]) ?? [])
        .map((r) => ({ droidId: idOf(String(r.droid ?? '')), tier: tierOf(r.tier) }))
        .filter((r): r is { droidId: string; tier: Tier } => !!r.droidId && !!r.tier)
      const cm = String(s.credits ?? '').match(/([0-9.]+)\s*(K|M|B|T|QA)?/i)
      const credits = cm ? Number(cm[1]) * ({ '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12, QA: 1e15 } as Record<string, number>)[(cm[2] ?? '').toUpperCase()] : undefined
      rebirths.push({ path, from, credits, droids: reqs })
      if (path === 1) {
        const areas = String(s.unlocks ?? '')
          .split(/[+,&]|\s+AND\s+/i)
          .map(areaOf)
          .filter((a): a is NonNullable<typeof a> => !!a)
        slotUnlocks.push({ level: from + 1, areas })
      }
    }
  }
  return { id: 'tycoontools', title: 'tycoon-tools.com', url: meta.url, fetchedAt: meta.fetchedAt, droids, rebirths, slotUnlocks, warnings }
}

// ---------------------------------------------------------------- droidex.web.app

/** `js` is Droidex's main bundle. It ships base (Default-tier) stats only. */
export function fromDroidex(js: string, meta: { url: string; fetchedAt: string }): SourceData {
  const ast = parseJs(js)
  const consts = topLevelConsts(ast)
  const droids: SourceDroid[] = findObjects(ast, ['name', 'rarity', 'class', 'baseIncome'], consts).map((d) => ({
    id: idOf(String(d.name)),
    name: String(d.name),
    rarity: rarityOf(d.rarity),
    class: classOf(d.class),
    income: num(d.baseIncome) !== undefined ? { default: num(d.baseIncome)! } : {},
  }))
  return { id: 'droidex', title: 'Droidex (droidex.web.app)', url: meta.url, fetchedAt: meta.fetchedAt, droids, rebirths: [], slotUnlocks: [], warnings: droids.length ? [] : ['droidex: no droids found'] }
}
