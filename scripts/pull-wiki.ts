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

// Every droid's own page (found via the pages that use the droid infobox), fetched 50 per request.
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt >= 2) throw e
      await sleep(5000 * (attempt + 1))
    }
  }
}
try {
  const list = await getJson(
    `${WIKI_BASE}/api.php?action=query&list=embeddedin&eititle=Template:Droid_Infobox_Official&einamespace=0&eilimit=500&format=json&formatversion=2`,
  )
  const titles: string[] = list.query.embeddedin.map((p: { title: string }) => p.title)
  const pages: { title: string; revision: number; wikitext: string }[] = []
  for (let i = 0; i < titles.length; i += 50) {
    await sleep(1500)
    const batch = titles.slice(i, i + 50).map(encodeURIComponent).join('|')
    const j = await getJson(`${WIKI_BASE}/api.php?action=query&prop=revisions&rvprop=content|ids&rvslots=main&titles=${batch}&format=json&formatversion=2`)
    for (const p of j.query.pages) if (p.revisions?.[0]) pages.push({ title: p.title, revision: p.revisions[0].revid, wikitext: p.revisions[0].slots.main.content })
  }
  if (pages.length < titles.length * 0.9) throw new Error(`only got ${pages.length}/${titles.length} droid pages`)
  pages.sort((a, b) => a.title.localeCompare(b.title))
  const file = `${RAW}/Droid_pages.json`
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const sig = (ps: { title: string; revision: number }[]) => ps.map((p) => `${p.title}@${p.revision}`).join(',')
  if (prev && sig(prev.pages) === sig(pages)) console.log(`= ${pages.length} droid pages unchanged`)
  else {
    writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), pages }, null, 1))
    console.log(`+ ${pages.length} droid pages updated`)
  }
  ok++
} catch (e) {
  failed.push(`droid pages: ${(e as Error).message}`)
  console.error(`! droid pages failed: ${(e as Error).message}`)
}

// Track consecutive nights with any failure so CI can open an issue after 3 in a row.
const statusFile = `${RAW}/_pull-status.json`
const prevFailures = existsSync(statusFile) ? (JSON.parse(readFileSync(statusFile, 'utf8')).consecutiveFailures ?? 0) : 0
const consecutiveFailures = failed.length ? prevFailures + 1 : 0
writeFileSync(statusFile, JSON.stringify({ ok, failed, consecutiveFailures }, null, 1) + '\n')
if (ok === 0) process.exit(2)
