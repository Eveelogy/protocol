// Combines the wiki with community fan sites by majority vote. Every disagreement is reported.
import type { DroidDef, RebirthStep, RebirthUnlock, Tier } from '../domain/types.ts'
import type { SourceData } from './sources/extract.ts'

/** Tie-break order when sources split evenly. */
export const SOURCE_PRIORITY = ['wiki', 'pagesdev', 'droidex', 'tycoontools']
const rank = (s: string) => {
  const i = SOURCE_PRIORITY.indexOf(s)
  return i < 0 ? 99 : i
}

interface Vote<T> {
  value: T
  source: string
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(a) * 0.005)

/** Majority value; ties go to the highest-priority source. Returns the groups for reporting. */
export function vote<T>(votes: Vote<T>[], eq: (a: T, b: T) => boolean = (a, b) => a === b): { value: T; agreed: number; groups: Vote<T>[][] } | undefined {
  if (!votes.length) return undefined
  const groups: Vote<T>[][] = []
  for (const v of votes) {
    const g = groups.find((x) => eq(x[0].value, v.value))
    if (g) g.push(v)
    else groups.push([v])
  }
  groups.sort((a, b) => b.length - a.length || Math.min(...a.map((v) => rank(v.source))) - Math.min(...b.map((v) => rank(v.source))))
  const best = groups[0]
  const pick = [...best].sort((a, b) => rank(a.source) - rank(b.source))[0]
  return { value: pick.value, agreed: best.length, groups }
}

const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v))
const describe = <T>(label: string, r: NonNullable<ReturnType<typeof vote<T>>>, show: (v: T) => string = fmt) =>
  `${label}: ${r.groups.map((g) => `${g.map((v) => v.source).join('+')} ${show(g[0].value)}`).join(' · ')} → using ${show(r.value)}`

export interface MergeResult {
  inconsistencies: string[]
  added: string[]
  unmatched: string[]
}

/**
 * Mutates `droids`, `rebirths` and `unlocks` (which hold wiki values) to the voted values.
 * Droids only the fan sites know are added when at least two sites list them.
 */
/** Spelling-insensitive key: "L0"/"LO", "JO9-4MN"/"J09-4MN", "BB-8"/"BB8", "DJ R-3X"/"DJ-R3X" all match. */
export const canon = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/0/g, 'o')

/** Rewrites every droid id in the fan-site data to the wiki's spelling where they match. */
function alignIds(droids: Map<string, DroidDef>, sources: SourceData[]): SourceData[] {
  const byCanon = new Map([...droids.keys()].map((id) => [canon(id), id]))
  const fix = (id: string) => byCanon.get(canon(id)) ?? id
  return sources.map((s) => ({
    ...s,
    droids: s.droids.map((d) => ({ ...d, id: fix(d.id) })),
    rebirths: s.rebirths.map((r) => ({ ...r, droids: r.droids.map((x) => ({ ...x, droidId: fix(x.droidId) })) })),
  }))
}

export function mergeSources(droids: Map<string, DroidDef>, rebirths: RebirthStep[], unlocks: RebirthUnlock[], rawSources: SourceData[]): MergeResult {
  const sources = alignIds(droids, rawSources)
  const inconsistencies: string[] = []
  const added: string[] = []
  const unmatched: string[] = []

  // ---- droids
  const ids = new Set([...droids.keys(), ...sources.flatMap((s) => s.droids.map((d) => d.id))])
  for (const id of ids) {
    const fromSites = sources.flatMap((s) => s.droids.filter((d) => d.id === id).map((d) => ({ s: s.id, d })))
    let def = droids.get(id)
    if (!def) {
      if (fromSites.length < 2) {
        if (fromSites.length) unmatched.push(`${fromSites[0].d.name} (only on ${fromSites[0].s})`)
        continue
      }
      const r = vote(fromSites.filter((x) => x.d.rarity).map((x) => ({ value: x.d.rarity!, source: x.s })))
      const c = vote(fromSites.filter((x) => x.d.class).map((x) => ({ value: x.d.class!, source: x.s })))
      if (!r || !c) continue
      def = { id, name: fromSites[0].d.name, rarity: r.value, class: c.value, income: {}, craftSeconds: {} }
      droids.set(id, def)
      added.push(def.name)
    }
    if (!fromSites.length) continue
    const d = def

    const rv = vote([...(d.rarity ? [{ value: d.rarity, source: 'wiki' }] : []), ...fromSites.filter((x) => x.d.rarity).map((x) => ({ value: x.d.rarity!, source: x.s }))])
    if (rv) {
      if (rv.groups.length > 1) inconsistencies.push(describe(`${d.name} rarity`, rv))
      d.rarity = rv.value
    }
    if (d.rarity === 'iconic') continue // Iconics earn a share of income; tier stats don't apply
    const cv = vote([{ value: d.class, source: 'wiki' }, ...fromSites.filter((x) => x.d.class).map((x) => ({ value: x.d.class!, source: x.s }))])
    if (cv) {
      if (cv.groups.length > 1) inconsistencies.push(describe(`${d.name} class`, cv))
      d.class = cv.value
    }
    if (d.class === 'protocol') continue // protocol droids boost areas instead of earning

    const tiers = new Set<Tier>([...(Object.keys(d.income) as Tier[]), ...fromSites.flatMap((x) => Object.keys(x.d.income) as Tier[])])
    for (const t of tiers) {
      const votes: Vote<number>[] = []
      if (d.income[t] !== undefined) votes.push({ value: d.income[t]!, source: 'wiki' })
      for (const x of fromSites) if (x.d.income[t] !== undefined) votes.push({ value: x.d.income[t]!, source: x.s })
      const v = vote(votes, sameNumber)
      if (!v) continue
      if (v.groups.length > 1) inconsistencies.push(describe(`${d.name} ${t} income`, v))
      d.income[t] = v.value
    }
    for (const x of fromSites)
      for (const [t, sec] of Object.entries(x.d.craftSeconds ?? {}) as [Tier, number][]) {
        d.craftSeconds ??= {}
        d.craftSeconds[t] ??= sec
      }
    if (Object.keys(d.income).length) d.incomplete = false
  }

  // ---- rebirth requirements
  const sig = (r: { droidId: string; tier: Tier }[]) =>
    r
      .map((x) => `${x.droidId}@${x.tier}`)
      .sort()
      .join(', ')
  for (const step of rebirths) {
    const others = sources.flatMap((s) => s.rebirths.filter((r) => r.path === step.path && r.from === step.from).map((r) => ({ s: s.id, r })))
    if (!others.length) continue
    const dv = vote([{ value: sig(step.droids), source: 'wiki' }, ...others.filter((o) => o.r.droids.length === 3).map((o) => ({ value: sig(o.r.droids), source: o.s }))])
    if (dv && dv.groups.length > 1) {
      inconsistencies.push(describe(`Path ${step.path} rebirth ${step.from}→${step.from + 1} droids`, dv))
      if (dv.value !== sig(step.droids)) {
        const winner = others.find((o) => sig(o.r.droids) === dv.value)!
        step.droids = winner.r.droids.map((x) => ({ ...x }))
      }
    }
    const credits = vote(
      [{ value: step.credits, source: 'wiki' }, ...others.filter((o) => o.r.credits !== undefined).map((o) => ({ value: o.r.credits!, source: o.s }))],
      sameNumber,
    )
    if (credits && credits.groups.length > 1) {
      inconsistencies.push(describe(`Path ${step.path} rebirth ${step.from}→${step.from + 1} credits`, credits))
      step.credits = credits.value
    }
  }

  // ---- earning-slot unlocks
  const slotSig = (s: Partial<Record<string, number>>) =>
    (['worker', 'astromech', 'battle', 'lounge'] as const)
      .flatMap((a) => Array(s[a] ?? 0).fill(a))
      .join('+') || 'none'
  for (const u of unlocks) {
    const others = sources.flatMap((s) => s.slotUnlocks.filter((x) => x.level === u.level).map((x) => ({ s: s.id, areas: x.areas })))
    if (!others.length) continue
    const toCounts = (areas: string[]) => areas.reduce<Record<string, number>>((m, a) => ({ ...m, [a]: (m[a] ?? 0) + 1 }), {})
    const v = vote([{ value: slotSig(u.slots), source: 'wiki' }, ...others.map((o) => ({ value: slotSig(toCounts(o.areas)), source: o.s }))])
    if (v && v.groups.length > 1) {
      inconsistencies.push(describe(`Rebirth ${u.level} slot unlocks`, v))
      if (v.value !== slotSig(u.slots)) {
        const w = others.find((o) => slotSig(toCounts(o.areas)) === v.value)!
        u.slots = toCounts(w.areas)
      }
    }
  }

  return { inconsistencies, added, unmatched }
}
