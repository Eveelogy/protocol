// Small, forgiving helpers for the hand-written wikitext tables on the Droid Tycoon wiki.
import { type Tier, type Rarity, type DroidClass, TIERS } from '../../domain/types.ts'

const SUFFIX: Record<string, number> = {
  '': 1,
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
  qa: 1e15,
  qi: 1e18,
}

/** "10K" → 10000, "1.2Qa" → 1.2e15, "1.08K/s" → 1080, "2/min" → 2. Returns NaN if unparseable. */
export function parseAmount(raw: string): number {
  // Accept "1.08K/s", "2/min" and the occasional typo "23.46ks".
  const s = stripMarkup(raw).replace(/,/g, '').trim().replace(/\/?(s|min)$/i, '').trim()
  const m = s.match(/^([0-9]*\.?[0-9]+)\s*(qa|qi|k|m|b|t)?$/i)
  if (!m) return Number.NaN
  return Number(m[1]) * SUFFIX[(m[2] ?? '').toLowerCase()]
}

/** "0:02:14" / "00:00:37" / "1:28:00" → seconds. */
export function parseDuration(raw: string): number {
  const s = stripMarkup(raw).trim()
  const parts = s.split(':').map(Number)
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return Number.NaN
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** Removes links, templates, bold/italics, footnote superscripts and HTML. Keeps link text. */
export function stripMarkup(raw: string): string {
  return raw
    .replace(/\[\[File:[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰⁻*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First [[Link]] target (or its display text) in a cell. */
export function firstLink(raw: string): string | undefined {
  const cleaned = raw.replace(/\[\[File:[^\]]*?\|thumb\|\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*\]\]/gi, '[[$1]]')
  const m = cleaned.match(/\[\[(?!File:)([^\]|]+)(?:\|([^\]]*))?\]\]/i)
  if (!m) return undefined
  return m[1].trim()
}

const TIER_ALIASES: Record<string, Tier> = {
  base: 'default',
  default: 'default',
  basic: 'default',
  gold: 'gold',
  diamond: 'diamond',
  rainbow: 'rainbow',
  beskar: 'beskar',
  galactic: 'galactic',
  stellar: 'stellar',
  kyber: 'kyber',
  kyberi: 'kyber',
  scourge: 'scourge',
}

export function tierFromVariant(raw: string): Tier | undefined {
  const m = raw.match(/\{\{Variant\|([A-Za-z]+)\}\}/)
  if (!m) return undefined
  return TIER_ALIASES[m[1].toLowerCase()]
}

export function rarityFrom(raw: string): Rarity | undefined {
  const m = raw.match(/Rarity\|([A-Za-z]+)/)
  const r = m?.[1].toLowerCase()
  return (['common', 'rare', 'epic', 'legendary', 'mythic', 'iconic'] as const).find((x) => x === r)
}

export function classFrom(raw: string): DroidClass | undefined {
  const m = raw.match(/(Worker|Astromech|Battle|Protocol)[ _]Icon/i)
  return m ? (m[1].toLowerCase() as DroidClass) : undefined
}

export interface WikiTable {
  caption: string
  /** Text between the previous heading and the table (used to find section names). */
  heading: string
  headers: string[]
  rows: string[][]
}

/**
 * Splits wikitext into tables. Supports both one-cell-per-line (`|cell`) and inline (`|| cell ||`) rows.
 * Nested tables are not supported (not used on the pages we read).
 */
export function parseTables(text: string): WikiTable[] {
  const tables: WikiTable[] = []
  const lines = text.split(/\r?\n/)
  let heading = ''
  let cur: WikiTable | null = null
  let row: string[] | null = null
  let cell: string | null = null

  const flushCell = () => {
    if (row && cell !== null) row.push(cell.trim())
    cell = null
  }
  const flushRow = () => {
    flushCell()
    if (cur && row && row.length) cur.rows.push(row)
    row = null
  }

  for (const line of lines) {
    const t = line.trim()
    if (!cur) {
      const h = t.match(/^=+\s*(.*?)\s*=+$/)
      if (h) heading = h[1]
      if (t.startsWith('{|')) cur = { caption: '', heading, headers: [], rows: [] }
      continue
    }
    // Some wiki tables are never closed with |} and just end at a wrapper tag or the next heading.
    const unclosedEnd = /^<\/(table-progress-tracking|div)>/i.test(t) || /^=+.*=+$/.test(t)
    if (t.startsWith('|}') || unclosedEnd) {
      flushRow()
      tables.push(cur)
      cur = null
      const h = t.match(/^=+\s*(.*?)\s*=+$/)
      if (h) heading = h[1]
      continue
    }
    if (t.startsWith('|+')) {
      cur.caption = stripMarkup(t.slice(2))
      continue
    }
    if (t.startsWith('|-')) {
      flushRow()
      row = []
      continue
    }
    if (t.startsWith('!')) {
      flushRow()
      for (const h of t.slice(1).split('!!')) cur.headers.push(stripMarkup(h))
      continue
    }
    if (t.startsWith('|')) {
      if (!row) row = []
      flushCell()
      const body = t.slice(1)
      if (body.includes('||')) {
        for (const c of splitInline(body)) row.push(c.trim())
      } else {
        cell = dropCellAttrs(body)
      }
      continue
    }
    // continuation of a multi-line cell (e.g. bullet lists)
    if (cell !== null) cell += '\n' + line
    else if (row && t) cell = line
  }
  return tables
}

/** Splits an inline row on `||`, ignoring `||` inside [[...]] or {{...}}, and drops `attr |` prefixes. */
function splitInline(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '[[' || two === '{{') {
      depth++
      buf += two
      i++
      continue
    }
    if ((two === ']]' || two === '}}') && depth > 0) {
      depth--
      buf += two
      i++
      continue
    }
    if (two === '||' && depth === 0) {
      out.push(dropCellAttrs(buf))
      buf = ''
      i++
      continue
    }
    buf += body[i]
  }
  out.push(dropCellAttrs(buf))
  return out
}

/** `colspan="10" |N/A` → `N/A`; a stray leading `|` (seen as `||  |4/s||`) is dropped too. */
function dropCellAttrs(cell: string): string {
  let c = cell.trim()
  if (c.startsWith('|')) c = c.slice(1)
  const m = c.match(/^([a-z-]+\s*=\s*"[^"]*"\s*)+\|(.*)$/i)
  if (m) c = m[2]
  return c.trim()
}

/** colspan value of a raw cell before attribute stripping is lost; callers treat "N/A" as end of levels. */
export const isNA = (cell: string) => /^n\/?a$/i.test(stripMarkup(cell))

export const tierOrderOk = (t: Tier) => TIERS.includes(t)
