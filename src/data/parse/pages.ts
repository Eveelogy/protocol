// Page-specific parsers. Each returns plain data plus warnings; nothing here touches the network.
import {
  type Area,
  type DroidClass,
  type NovaUpgradeDef,
  type Rarity,
  type RebirthStep,
  type RebirthUnlock,
  type Tier,
  slugify,
} from '../../domain/types.ts'
import {
  classFrom,
  firstLink,
  isNA,
  parseAmount,
  parseDuration,
  parseTables,
  rarityFrom,
  stripMarkup,
  tierFromVariant,
} from './wikitext.ts'

export interface ParseResult<T> {
  data: T
  warnings: string[]
}

// ---------------------------------------------------------------- Rebirths

export function parseRebirths(text: string): ParseResult<RebirthStep[]> {
  const warnings: string[] = []
  const steps: RebirthStep[] = []
  for (const table of parseTables(text)) {
    const pm = table.caption.match(/Path\s+(\d+)/i)
    if (!pm) continue
    const path = Number(pm[1])
    for (const row of table.rows) {
      if (row.length < 3) continue
      const fm = stripMarkup(row[0]).match(/^(\d+)\s*>\s*(\d+)$/)
      if (!fm) continue
      const from = Number(fm[1])
      const droids = row[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('*'))
        .map((l) => ({ tier: tierFromVariant(l), name: firstLink(l) }))
      const parsed = droids.filter((d): d is { tier: Tier; name: string } => !!d.tier && !!d.name)
      if (parsed.length !== droids.length || parsed.length !== 3)
        warnings.push(`Rebirths: path ${path} ${from}>${from + 1} has ${parsed.length}/3 parseable droids`)
      const credits = parseAmount(row[2])
      if (Number.isNaN(credits)) warnings.push(`Rebirths: path ${path} ${from}>${from + 1} credits "${row[2]}" unparseable`)
      steps.push({
        path,
        from,
        credits,
        droids: parsed.map((d) => ({ droidId: slugify(d.name), tier: d.tier })),
      })
    }
  }
  for (let p = 1; p <= 6; p++) {
    const n = steps.filter((s) => s.path === p).length
    if (n !== 40) warnings.push(`Rebirths: path ${p} has ${n}/40 steps`)
  }
  return { data: steps, warnings }
}

const SLOT_WORDS: Record<string, Area | 'lounge'> = {
  worker: 'worker',
  astromech: 'astromech',
  battle: 'battle',
  lounge: 'lounge',
}

export function parseRebirthUnlocks(text: string): ParseResult<RebirthUnlock[]> {
  const warnings: string[] = []
  const out: RebirthUnlock[] = []
  const table = parseTables(text).find((t) => t.headers.some((h) => /Base Upgrades/i.test(h)))
  if (!table) return { data: out, warnings: ['Rebirths: "Other unlocks" table not found'] }
  const col = (name: RegExp) => table.headers.findIndex((h) => name.test(h))
  const iLevel = col(/Rebirth Level/i)
  const iMult = col(/Credit Mul/i)
  const iBase = col(/Base Upgrades/i)
  for (const row of table.rows) {
    const level = Number(stripMarkup(row[iLevel] ?? ''))
    if (!Number.isInteger(level) || level < 1) continue
    const baseText = stripMarkup(row[iBase] ?? '')
    const slots: RebirthUnlock['slots'] = {}
    for (const m of baseText.matchAll(/(Worker|Astromech|Battle|Lounge)/gi)) {
      const k = SLOT_WORDS[m[1].toLowerCase()]
      slots[k] = (slots[k] ?? 0) + 1
    }
    const mult = stripMarkup(row[iMult] ?? '').match(/([0-9.]+)\s*%/)
    out.push({
      level,
      creditMultiplier: mult ? Number(mult[1]) / 100 : undefined,
      baseUpgrade: baseText && !isNA(baseText) ? baseText : undefined,
      slots,
    })
  }
  if (out.length < 40) warnings.push(`Rebirths: "Other unlocks" covers ${out.length}/40 levels (stub on wiki)`)
  return { data: out, warnings }
}

// ---------------------------------------------------------------- Droids

export interface ParsedDroidRow {
  name: string
  rarity: Rarity
  class?: DroidClass
  tier: Tier
  income: number
  craftSeconds?: number
}

/** Reads every tier table on "List of Droids". */
export function parseDroidList(text: string): ParseResult<ParsedDroidRow[]> {
  const warnings: string[] = []
  const out: ParsedDroidRow[] = []
  for (const table of parseTables(text)) {
    const tier = tierFromVariant(table.caption) ?? tierFromVariant(table.heading) ?? captionTier(table.caption, table.heading)
    if (!tier) continue
    const h = (re: RegExp) => table.headers.findIndex((x) => re.test(x))
    const iName = h(/^Name$/i)
    const iRarity = h(/^Rarity$/i)
    const iType = h(/^Type$/i)
    const iIncome = h(/^Income$/i)
    const iCraft = h(/Crafting Time/i)
    if (iName < 0 || iIncome < 0) continue
    for (const row of table.rows) {
      const name = firstLink(row[iName] ?? '') ?? stripMarkup(row[iName] ?? '')
      const rarity = rarityFrom(row[iRarity] ?? '')
      // Protocol droids earn nothing themselves; the wiki shows "-" for them.
      const rawIncome = stripMarkup(row[iIncome] ?? '')
      const income = /^-?$|^\/s$/.test(rawIncome) ? 0 : parseAmount(rawIncome)
      if (!name || !rarity) continue
      if (Number.isNaN(income)) {
        warnings.push(`List of Droids: ${tier} ${name} income "${row[iIncome]}" unparseable`)
        continue
      }
      const craft = iCraft >= 0 ? parseDuration(row[iCraft] ?? '') : Number.NaN
      out.push({
        name,
        rarity,
        class: classFrom(row[iType] ?? ''),
        tier,
        income,
        craftSeconds: Number.isNaN(craft) ? undefined : craft,
      })
    }
  }
  return { data: out, warnings }
}

function captionTier(caption: string, heading: string): Tier | undefined {
  const s = `${caption} ${heading}`.toLowerCase()
  if (/\bbase\b/.test(s)) return 'default'
  return undefined
}

// ---------------------------------------------------------------- Fusion

export interface ParsedFusion {
  name: string
  rarity?: Rarity
  components: [string, string, string]
}

export function parseFusions(text: string): ParseResult<ParsedFusion[]> {
  const warnings: string[] = []
  const out: ParsedFusion[] = []
  for (const table of parseTables(text)) {
    if (!/Fusion/i.test(table.caption) || !table.headers.some((x) => /Droid 1/i.test(x))) continue
    for (const row of table.rows) {
      if (row.length < 5) continue
      const name = firstLink(row[0])
      const comps = row.slice(2, 5).map((c) => firstLink(c))
      if (!name || comps.some((c) => !c)) {
        warnings.push(`Fusion: could not parse row "${stripMarkup(row.join(' | ')).slice(0, 60)}"`)
        continue
      }
      out.push({ name, rarity: rarityFrom(row[1]), components: comps as [string, string, string] })
    }
  }
  return { data: out, warnings }
}

// ---------------------------------------------------------------- Nova Shop

export function parseNovaShop(text: string): ParseResult<NovaUpgradeDef[]> {
  const warnings: string[] = []
  const out: NovaUpgradeDef[] = []
  for (const table of parseTables(text)) {
    if (table.headers[0] !== 'Levels') continue
    const section = table.caption || table.heading
    for (const row of table.rows) {
      const rawName = stripMarkup(row[0] ?? '')
      if (!rawName) continue
      const unlimited = /\*/.test(row[0])
      const costs: number[] = []
      for (const c of row.slice(1)) {
        if (isNA(c) || /every level/i.test(c)) break
        const n = parseAmount(c)
        if (Number.isNaN(n)) break
        costs.push(n)
      }
      if (!costs.length) {
        warnings.push(`Nova Shop: no costs for "${rawName}"`)
        continue
      }
      out.push({ id: slugify(rawName.replace(/\(.*?\)/g, '')), name: rawName, section, costs, unlimited })
    }
  }
  return { data: out, warnings }
}
