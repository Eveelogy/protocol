// Builds src/data/game-data.json from data/raw + data/supplements, and writes data/build-report.json.
// Refuses to overwrite the last good dataset if the new one looks broken (exit code 3).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { SourceData } from '../src/data/sources/extract.ts'
import { WIKI_PAGES, buildGameData, type RawPage, type Supplements, type WikiPage } from '../src/data/build.ts'

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T

const pages: Partial<Record<WikiPage, RawPage>> = {}
for (const p of WIKI_PAGES) if (existsSync(`data/raw/${p}.json`)) pages[p] = readJson<RawPage>(`data/raw/${p}.json`)

const sup: Supplements = {
  constants: readJson('data/supplements/constants.json'),
  resetRules: readJson('data/supplements/reset-rules.json'),
  droids: readJson<{ droids: Supplements['droids'] }>('data/supplements/droids.json').droids,
}

function detectGameVersion(): string {
  const f = 'data/raw/Droid_Tycoon_Update_Log_-_2026.json'
  if (!existsSync(f)) return 'unknown'
  const text = readJson<RawPage>(f).wikitext
  const versions = [...text.matchAll(/v(\d+\.\d+(?:\.\d+)?)/g)].map((m) => m[1])
  const cmp = (a: string, b: string) => {
    const x = a.split('.').map(Number)
    const y = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
    return 0
  }
  return versions.sort(cmp).at(-1) ?? 'unknown'
}

const droidPages: RawPage[] = existsSync('data/raw/Droid_pages.json')
  ? readJson<{ pages: { title: string; revision: number; wikitext: string }[] }>('data/raw/Droid_pages.json').pages
  : []
const sources: SourceData[] = existsSync('data/raw/sources')
  ? readdirSync('data/raw/sources')
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .sort()
      .map((f) => readJson<SourceData>(`data/raw/sources/${f}`))
  : []
const { data, report } = buildGameData(pages, sup, { gameVersion: detectGameVersion(), builtAt: new Date().toISOString(), droidPages, sources })

// Sanity gate: never replace good data with an obviously broken build.
const problems: string[] = []
if (data.rebirths.length < 200) problems.push(`only ${data.rebirths.length} rebirth steps`)
if (data.droids.length < 60) problems.push(`only ${data.droids.length} droids`)
if (data.nova.length < 10) problems.push(`only ${data.nova.length} nova upgrades`)

const out = 'src/data/game-data.json'
writeFileSync('data/build-report.json', JSON.stringify({ ...report, problems, builtAt: data.builtAt }, null, 2) + '\n')
if (problems.length) {
  console.error('Build rejected, keeping previous data:', problems.join('; '))
  process.exit(3)
}

// Only bump builtAt when content actually changed, so nightly runs without changes produce no diff.
if (existsSync(out)) {
  const prev = readJson<typeof data>(out)
  const strip = (d: typeof data) => JSON.stringify({ ...d, builtAt: '', sources: d.sources.map((s) => ({ ...s, fetchedAt: '' })) })
  if (strip(prev) === strip(data)) {
    console.log('Game data unchanged.')
    process.exit(0)
  }
}
writeFileSync(out, JSON.stringify(data, null, 1) + '\n')
console.log(
  `Built ${data.droids.length} droids, ${data.rebirths.length} rebirth steps, ${data.nova.length} nova upgrades; ` +
    `${report.warnings.length} warnings, ${report.disputes.length} disputes, ${report.overlaps.length} overlaps, ${report.inconsistencies.length} wiki inconsistencies. Game v${data.gameVersion}`,
)
