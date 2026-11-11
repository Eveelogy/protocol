// Turns raw wiki pages + hand-written supplements into the app's GameData. Pure: no I/O.
import {
  type DroidDef,
  type Dispute,
  type GameConstants,
  type GameData,
  type ResetRules,
  type Tier,
  TIERS,
  slugify,
} from '../domain/types.ts'
import { parseDroidList, parseFusions, parseNovaShop, parseRebirthUnlocks, parseRebirths } from './parse/pages.ts'

export const WIKI_PAGES = ['Rebirths', 'List_of_Droids', 'Droid_Fusion', 'Nova_Shop'] as const
export type WikiPage = (typeof WIKI_PAGES)[number]

export interface RawPage {
  title: string
  wikitext: string
  revision?: number
  fetchedAt?: string
}

export interface Supplements {
  constants: GameConstants & Record<string, unknown>
  resetRules: ResetRules
  droids: (Partial<DroidDef> & { id: string })[]
}

export interface BuildReport {
  warnings: string[]
  disputes: Dispute[]
  /** Supplement values the wiki now also provides — candidates for deletion. */
  overlaps: string[]
}

export const WIKI_BASE = 'https://star-wars-droid-tycoon.fandom.com'

export function buildGameData(
  pages: Partial<Record<WikiPage, RawPage>>,
  sup: Supplements,
  opts: { gameVersion: string; builtAt: string },
): { data: GameData; report: BuildReport } {
  const warnings: string[] = []
  const disputes: Dispute[] = []
  const overlaps: string[] = []
  const need = (p: WikiPage) => {
    const page = pages[p]
    if (!page) throw new Error(`Missing wiki page ${p}`)
    return page.wikitext
  }

  const rebirths = parseRebirths(need('Rebirths'))
  const unlocks = parseRebirthUnlocks(need('Rebirths'))
  const list = parseDroidList(need('List_of_Droids'))
  const fusions = parseFusions(need('Droid_Fusion'))
  const nova = parseNovaShop(need('Nova_Shop'))
  warnings.push(...rebirths.warnings, ...unlocks.warnings, ...list.warnings, ...fusions.warnings, ...nova.warnings)

  // --- droids from the wiki list
  const droids = new Map<string, DroidDef>()
  for (const row of list.data) {
    const id = slugify(row.name)
    let d = droids.get(id)
    if (!d) {
      d = { id, name: row.name, rarity: row.rarity, class: row.class ?? 'worker', income: {}, craftSeconds: {} }
      if (!row.class) warnings.push(`Droid ${row.name}: class unknown, defaulted to worker`)
      droids.set(id, d)
    }
    if (row.class && d.class !== row.class && row.class !== 'worker') d.class = row.class
    d.income[row.tier] = row.income
    if (row.craftSeconds !== undefined) d.craftSeconds![row.tier] = row.craftSeconds
  }

  // --- fusion recipes
  for (const f of fusions.data) {
    const id = slugify(f.name)
    const d = droids.get(id)
    const comps = f.components.map(slugify) as [string, string, string]
    if (d) d.fusionOf = comps
    else {
      droids.set(id, { id, name: f.name, rarity: f.rarity ?? 'rare', class: 'worker', income: {}, fusionOf: comps, incomplete: true })
      warnings.push(`Fusion droid ${f.name} is not on List of Droids; income unknown`)
    }
  }

  // --- supplements (merge over wiki, record disputes/overlaps)
  for (const s of sup.droids) {
    const existing = droids.get(s.id)
    if (!existing) {
      if (!s.name || !s.rarity || !s.class) {
        warnings.push(`Supplement ${s.id}: no wiki entry and missing name/rarity/class`)
        continue
      }
      droids.set(s.id, { income: {}, ...s } as DroidDef)
      continue
    }
    if (s.incomplete && Object.keys(existing.income).length) overlaps.push(`droids.${s.id}: wiki now lists this droid; remove the placeholder`)
    for (const [k, v] of Object.entries(s)) {
      if (k === 'id' || v === undefined) continue
      if (k === 'income') {
        for (const [tier, val] of Object.entries(v as Record<string, number>)) {
          const wiki = existing.income[tier as Tier]
          if (wiki !== undefined && wiki !== val)
            disputes.push({
              key: `droids.${s.id}.income.${tier}`,
              values: [
                { value: wiki, source: 'wiki' },
                { value: val, source: 'supplement' },
              ],
              chosen: 'supplement',
            })
          else if (wiki !== undefined) overlaps.push(`droids.${s.id}.income.${tier}: same value now on wiki`)
          existing.income[tier as Tier] = val
        }
        continue
      }
      ;(existing as unknown as Record<string, unknown>)[k] = v
    }
    if (s.protocolBonus) existing.class = 'protocol'
  }

  // --- derived incomes (flagged) for gaps
  const c = sup.constants
  for (const d of droids.values()) {
    if (d.craftSeconds && !Object.keys(d.craftSeconds).length) delete d.craftSeconds
    if (d.rarity === 'iconic' || d.class === 'protocol') continue
    const derived: Tier[] = []
    const inc = d.income
    if (inc.default === undefined && inc.gold !== undefined) {
      inc.default = inc.gold / 2
      derived.push('default')
    }
    if (inc.stellar !== undefined) {
      if (inc.kyber === undefined) {
        inc.kyber = round(inc.stellar * c.inactiveKyberOfStellar)
        derived.push('kyber')
      }
      if (inc.scourge === undefined) {
        inc.scourge = round(inc.stellar * c.scourgeOfStellar)
        derived.push('scourge')
      }
    }
    if (derived.length) d.derivedIncome = derived
    if (!Object.keys(inc).length && !d.incomplete) {
      d.incomplete = true
      warnings.push(`Droid ${d.name}: no income data`)
    }
    if (d.craftSeconds && !Object.keys(d.craftSeconds).length) delete d.craftSeconds
  }

  // --- referential checks
  for (const s of rebirths.data)
    for (const r of s.droids)
      if (!droids.has(r.droidId)) warnings.push(`Rebirth path ${s.path} ${s.from}>${s.from + 1} needs unknown droid "${r.droidId}"`)

  const { _comment: _ignored, ...constants } = sup.constants as Record<string, unknown>
  void _ignored
  const data: GameData = {
    schema: 1,
    builtAt: opts.builtAt,
    gameVersion: opts.gameVersion,
    sources: WIKI_PAGES.filter((p) => pages[p]).map((p) => ({
      id: `wiki:${p}`,
      title: pages[p]!.title,
      url: `${WIKI_BASE}/wiki/${p}`,
      license: 'CC BY-SA 3.0',
      revision: pages[p]!.revision,
      fetchedAt: pages[p]!.fetchedAt,
    })),
    droids: [...droids.values()].sort((a, b) => a.name.localeCompare(b.name)),
    rebirths: rebirths.data,
    unlocks: unlocks.data,
    nova: nova.data,
    constants: stripComments(constants) as unknown as GameConstants,
    resetRules: stripComments(sup.resetRules) as unknown as ResetRules,
    disputes,
    warnings,
  }
  return { data, report: { warnings, disputes, overlaps } }
}

const round = (n: number) => Math.round(n * 100) / 100

function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, x]) => [k, stripComments(x)]),
    )
  return v
}

export const ALL_TIERS = TIERS
