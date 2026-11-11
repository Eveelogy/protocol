// Open data issues/PRs from the public GitHub repo (label "data"), so the nightly job can ask for help.
import { useEffect, useState } from 'react'

export const REPO = 'Eveelogy/protocol'

interface Issue {
  number: number
  title: string
  html_url: string
  pull_request?: unknown
}

let cache: Promise<Issue[]> | null = null
function loadIssues(): Promise<Issue[]> {
  cache ??= (async () => {
    try {
      const raw = sessionStorage.getItem('protocol.dataIssues')
      if (raw) {
        const { at, items } = JSON.parse(raw) as { at: number; items: Issue[] }
        if (Date.now() - at < 3600_000) return items
      }
    } catch {
      /* storage unavailable */
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/issues?labels=data&state=open&per_page=20`, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) return []
      const items = ((await res.json()) as Issue[]).map(({ number, title, html_url, pull_request }) => ({ number, title, html_url, pull_request }))
      try {
        sessionStorage.setItem('protocol.dataIssues', JSON.stringify({ at: Date.now(), items }))
      } catch {
        /* storage unavailable */
      }
      return items
    } catch {
      return [] // offline: just show nothing
    }
  })()
  return cache
}

export function useDataIssues(): Issue[] {
  const [items, setItems] = useState<Issue[]>([])
  useEffect(() => {
    let alive = true
    void loadIssues().then((x) => alive && setItems(x))
    return () => {
      alive = false
    }
  }, [])
  return items
}

export function DataIssuesBadge({ dot }: { dot?: boolean }) {
  const items = useDataIssues()
  if (!items.length) return null
  if (dot) return <span className="absolute -top-1 -right-2 h-2.5 w-2.5 rounded-full bg-bad" aria-label={`${items.length} data issue(s)`} />
  return (
    <div className="rounded-lg border border-bad/60 bg-bad/5 p-3 text-sm">
      <div className="font-semibold">
        {items.length} data {items.length === 1 ? 'issue needs' : 'issues need'} you
      </div>
      <ul className="mt-1 list-disc pl-5">
        {items.map((i) => (
          <li key={i.number}>
            <a className="underline" href={i.html_url} target="_blank" rel="noreferrer">
              {i.pull_request ? 'PR' : 'Issue'} #{i.number}: {i.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
