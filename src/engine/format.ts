const UNITS: [number, string][] = [
  [1e18, 'Qi'],
  [1e15, 'Qa'],
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
]

export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  const a = Math.abs(n)
  for (const [v, u] of UNITS) if (a >= v) return `${trim(n / v)}${u}`
  return trim(n)
}

// Only strip zeros that follow a decimal point ("2.50" → "2.5", "220" stays "220").
const trim = (n: number) =>
  (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—' // no income yet
  if (seconds <= 0) return 'now'
  const s = Math.round(seconds)
  const d = Math.floor(s / 86400)
  if (d >= 365) return `${(d / 365).toFixed(d >= 3650 ? 0 : 1)}y`
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m`
  return `${s}s`
}

/** Parses "1.5M", "2b", "15Qa", "1,200". */
export function parseAmountInput(raw: string): number {
  const m = raw.trim().replace(/,/g, '').match(/^([0-9]*\.?[0-9]+)\s*(k|m|b|t|qa|qi)?$/i)
  if (!m) return Number.NaN
  const mult: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18 }
  return Number(m[1]) * mult[(m[2] ?? '').toLowerCase()]
}
