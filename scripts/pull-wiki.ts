// Fetches the wiki pages we parse via the MediaWiki API and stores them in data/raw/.
// A page that fails to download keeps its previous copy. Exit code 2 = nothing could be fetched.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { WIKI_BASE, WIKI_PAGES } from '../src/data/build.ts'

const EXTRA_PAGES = ['Droid_Tycoon_Update_Log_-_2026'] // used to detect the current game version
const UA = 'ProtocolTrackerDataBot/0.1 (personal fan tracker; nightly, ~6 requests; https://github.com/)'
const RAW = 'data/raw'
mkdirSync(RAW, { recursive: true })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchPage(page: string): Promise<{ wikitext: string; revision: number }> {
  const url = `${WIKI_BASE}/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext|revid&redirects=1&format=json&formatversion=2`
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { parse?: { wikitext: string; revid: number }; error?: { info: string } }
      if (!json.parse) throw new Error(json.error?.info ?? 'no parse result')
      return { wikitext: json.parse.wikitext, revision: json.parse.revid }
    } catch (e) {
      lastErr = e
      await sleep(5000 * (attempt + 1))
    }
  }
  throw lastErr
}

let ok = 0
const failed: string[] = []
for (const page of [...WIKI_PAGES, ...EXTRA_PAGES]) {
  const file = `${RAW}/${page}.json`
  try {
    const { wikitext, revision } = await fetchPage(page)
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
    if (prev?.revision === revision) console.log(`= ${page} unchanged (rev ${revision})`)
    else {
      writeFileSync(file, JSON.stringify({ title: page.replace(/_/g, ' '), revision, fetchedAt: new Date().toISOString(), wikitext }, null, 1))
      console.log(`+ ${page} updated (rev ${revision})`)
    }
    ok++
  } catch (e) {
    failed.push(`${page}: ${(e as Error).message}`)
    console.error(`! ${page} failed: ${(e as Error).message}`)
  }
  await sleep(1500)
}
// Track consecutive nights with any failure so CI can open an issue after 3 in a row.
const statusFile = `${RAW}/_pull-status.json`
const prevFailures = existsSync(statusFile) ? (JSON.parse(readFileSync(statusFile, 'utf8')).consecutiveFailures ?? 0) : 0
const consecutiveFailures = failed.length ? prevFailures + 1 : 0
writeFileSync(statusFile, JSON.stringify({ ok, failed, consecutiveFailures }, null, 1) + '\n')
if (ok === 0) process.exit(2)
