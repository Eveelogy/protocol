// Fetches community fan sites and saves only the extracted facts (names and numbers) to data/raw/sources/.
// The sites' code is parsed, never executed, and never stored. A site that fails keeps its last good facts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { type SourceData, fromDroidex, fromPagesDev, fromTycoonTools } from '../src/data/sources/extract.ts'

const UA = 'ProtocolTrackerDataBot/0.1 (fan tracker; reads public data once a night)'
const OUT = 'data/raw/sources'
mkdirSync(OUT, { recursive: true })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return await res.text()
    } catch (e) {
      if (attempt >= 2) throw e
      await sleep(4000 * (attempt + 1))
    }
  }
}

/** Finds the main module script referenced by a Vite-built index.html. */
async function mainBundle(origin: string): Promise<string> {
  const html = await get(`${origin}/`)
  const src = html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/)?.[1]
  if (!src) throw new Error(`no main bundle on ${origin}`)
  await sleep(1000)
  return get(origin + src)
}

const fetchedAt = new Date().toISOString()
const sites: { id: string; run: () => Promise<SourceData>; minDroids: number }[] = [
  {
    id: 'pagesdev',
    minDroids: 60,
    run: async () => {
      const origin = 'https://droid-tycoon.pages.dev'
      const main = await mainBundle(origin)
      const chunk = (name: string) => {
        const m = main.match(new RegExp(`assets/${name}-[A-Za-z0-9_-]+\\.js`))
        if (!m) throw new Error(`no ${name} chunk`)
        return `${origin}/${m[0]}`
      }
      const droids = await get(chunk('droids'))
      await sleep(1000)
      const rebirth = await get(chunk('rebirth'))
      return fromPagesDev(droids, rebirth, { url: `${origin}/`, fetchedAt })
    },
  },
  {
    id: 'tycoontools',
    minDroids: 60,
    run: async () => fromTycoonTools(await get('https://tycoon-tools.com/droid-tycoon/'), { url: 'https://tycoon-tools.com/droid-tycoon/', fetchedAt }),
  },
  {
    id: 'droidex',
    minDroids: 40,
    run: async () => fromDroidex(await mainBundle('https://droidex.web.app'), { url: 'https://droidex.web.app/', fetchedAt }),
  },
]

const failed: string[] = []
for (const site of sites) {
  const file = `${OUT}/${site.id}.json`
  try {
    const data = await site.run()
    if (data.droids.length < site.minDroids) throw new Error(`only ${data.droids.length} droids extracted (site layout may have changed)`)
    const strip = (d: SourceData) => JSON.stringify({ ...d, fetchedAt: '' })
    const prev = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SourceData) : null
    if (prev && strip(prev) === strip(data)) console.log(`= ${site.id} unchanged`)
    else {
      writeFileSync(file, JSON.stringify(data, null, 1) + '\n')
      console.log(`+ ${site.id}: ${data.droids.length} droids, ${data.rebirths.length} rebirth steps`)
    }
  } catch (e) {
    failed.push(`${site.id}: ${(e as Error).message}`)
    console.error(`! ${site.id} failed: ${(e as Error).message}`)
  }
  await sleep(1500)
}

const statusFile = `${OUT}/_status.json`
const prevFailures = existsSync(statusFile) ? (JSON.parse(readFileSync(statusFile, 'utf8')).consecutiveFailures ?? 0) : 0
writeFileSync(statusFile, JSON.stringify({ failed, consecutiveFailures: failed.length ? prevFailures + 1 : 0 }, null, 1) + '\n')
