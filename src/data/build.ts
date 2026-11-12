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
import { mergeSources } from './merge.ts'
import type { SourceData } from './sources/extract.ts'
import { parseDroidList, parseDroidPage, parseFusions, parseNovaShop, parseRebirthUnlocks, parseRebirths, parseSuperRebirth } from './parse/pages.ts'

export const WIKI_PAGES = ['Rebirths', 'List_of_Droids', 'Droid_Fusion', 'Nova_Shop', 'Super_Rebirth'] as const
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
  /** Wiki pages that disagree with each other (List of Droids vs a droid's own page). Informational only. */
  inconsistencies: string[]
}

export const WIKI_BASE = 'https://star-wars-droid-tycoon.fandom.com'

export function buildGameData(
  pages: Partial<Record<WikiPage, RawPage>>,
  sup: Supplements,
  opts: { gameVersion: string; builtAt: string; droidPages?: RawPage[]; sources?: SourceData[] },
): { data: GameData; report: BuildReport } {
  const warnings: string[] = []
  const inconsistencies: string[] = []
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
  const srb = pages.Super_Rebirth ? parseSuperRebirth(pages.Super_Rebirth.wikitext) : { data: [], warnings: ['Super Rebirth page missing'] }
  warnings.push(...srb.warnings)
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

  // --- individual droid pages: authoritative for rarity/class/iconic share, fill income gaps
  for (const page of opts.droidPages ?? []) {
    const p = parseDroidPage(page.title, page.wikitext)
    const id = slugify(p.name)
    let d = droids.get(id)
    if (!d) {
      if (!p.rarity || !p.class) {
        warnings.push(`Droid page ${p.name}: no rarity/class in infobox, skipped`)
        continue
      }
      d = { id, name: p.name, rarity: p.rarity, class: p.class, income: {}, craftSeconds: {} }
      droids.set(id, d)
    } else {
      if (p.rarity && p.rarity !== d.rarity) inconsistencies.push(`${d.name}: rarity ${d.rarity} on List of Droids, ${p.rarity} on its page (using page)`)
      if (p.class && p.class !== d.class) inconsistencies.push(`${d.name}: class ${d.class} on List of Droids, ${p.class} on its page (using page)`)
      if (p.rarity) d.rarity = p.rarity
      if (p.class) d.class = p.class
    }
    if (p.iconicShare !== undefined) d.iconicShare = p.iconicShare
    if (p.companion) d.companion = p.companion
    if (p.released) d.released = p.released
    for (const [tier, v] of Object.entries(p.income) as [Tier, number][]) {
      const listed = d.income[tier]
      if (listed === undefined) d.income[tier] = v
      else if (listed !== v) inconsistencies.push(`${d.name} ${tier} income: ${listed}/s on List of Droids, ${v}/s on its page (using list)`)
    }
    for (const [tier, v] of Object.entries(p.craftSeconds) as [Tier, number][]) d.craftSeconds![tier] ??= v
  }

  // --- community fan sites: majority vote with the wiki, every disagreement reported
  const siteSources = opts.sources ?? []
  if (siteSources.length) {
    const m = mergeSources(droids, rebirths.data, unlocks.data, siteSources)
    inconsistencies.push(...m.inconsistencies)
    if (m.added.length) warnings.push(`Added from fan sites (not on the wiki): ${m.added.join(', ')}`)
    if (m.unmatched.length) warnings.push(`Only one site lists (not added): ${m.unmatched.join(', ')}`)
    for (const s of siteSources) warnings.push(...s.warnings)
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

  // --- hand-written slot unlocks the wiki table is missing
  for (const x of (sup.constants as { extraSlotUnlocks?: { list: { level: number; area: 'worker' | 'astromech' | 'battle' }[] } }).extraSlotUnlocks?.list ?? []) {
    const u = unlocks.data.find((y) => y.level === x.level)
    if (u) u.slots[x.area] = (u.slots[x.area] ?? 0) + 1
    else unlocks.data.push({ level: x.level, slots: { [x.area]: 1 } })
  }

  // --- slot totals: starting slots + wiki unlocks should reach the in-game maximum
  const max = sup.constants.maxSlots
  if (max)
    for (const area of ['worker', 'astromech', 'battle'] as const) {
      const total = sup.constants.initialSlots[area] + unlocks.data.reduce((s, u) => s + (u.slots[area] ?? 0), 0)
      if (total !== max[area]) warnings.push(`Slots: ${area} reaches ${total} at rebirth 40 but the game max is ${max[area]} — check initialSlots or the wiki unlock table`)
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
    sources: [
      ...WIKI_PAGES.filter((p) => pages[p]).map((p): GameData['sources'][number] => ({
        id: `wiki:${p}`,
        title: pages[p]!.title,
        url: `${WIKI_BASE}/wiki/${p}`,
        license: 'CC BY-SA 3.0',
        revision: pages[p]!.revision,
        fetchedAt: pages[p]!.fetchedAt,
      })),
      ...siteSources.map((s): GameData['sources'][number] => ({ id: s.id, title: s.title, url: s.url, fetchedAt: s.fetchedAt })),
    ],
    droids: [...droids.values()].sort((a, b) => a.name.localeCompare(b.name)),
    rebirths: rebirths.data,
    unlocks: unlocks.data,
    superRebirth: srb.data,
    nova: nova.data,
    constants: stripComments(constants) as unknown as GameConstants,
    resetRules: stripComments(sup.resetRules) as unknown as ResetRules,
    disputes,
    warnings,
    inconsistencies,
  }
  return { data, report: { warnings, disputes, overlaps, inconsistencies } }
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
