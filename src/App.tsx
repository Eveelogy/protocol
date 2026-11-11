import { useEffect, useState } from 'react'
import { data, useStore } from './store/store.ts'
import { BaseView } from './views/BaseView.tsx'
import { CollectionView } from './views/CollectionView.tsx'
import { RebirthView } from './views/RebirthView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import { ToolsView } from './views/ToolsView.tsx'
import { DataIssuesBadge } from './ui/DataIssues.tsx'
import { Setup } from './views/Setup.tsx'

const TABS = [
  { id: 'rebirth', label: 'Rebirths', icon: '⟳' },
  { id: 'base', label: 'Base', icon: '▦' },
  { id: 'droids', label: 'Droids', icon: '◎' },
  { id: 'tools', label: 'Tools', icon: '⏱' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
] as const
type TabId = (typeof TABS)[number]['id']

const readTab = (): TabId => {
  try {
    const t = localStorage.getItem('protocol.tab')
    return (TABS.find((x) => x.id === t)?.id ?? 'rebirth') as TabId
  } catch {
    return 'rebirth'
  }
}

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const load = useStore((s) => s.load)
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const [tab, setTab] = useState<TabId>(readTab)

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    try {
      localStorage.setItem('protocol.tab', tab)
    } catch {
      /* private mode */
    }
  }, [tab])

  const retro = save.profile.ui.retro === 'terminal'
  const dataUpdated = loaded && save.setupDone && save.seenDataBuild && save.seenDataBuild !== data.builtAt

  if (!loaded) return <div className="p-8 text-center text-dim">Loading…</div>

  return (
    <div className={`${retro ? 'terminal' : ''} min-h-dvh pb-24`}>
      {retro && <div className="scanlines" aria-hidden />}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="heading readout text-lg font-black tracking-widest">PROTOCOL</div>
          <div className="num text-xs text-dim">
            P{save.profile.path} · R{save.profile.rebirth} · data v{data.gameVersion}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {dataUpdated && (
          <div className="panel flex items-center justify-between gap-2 p-3 text-sm">
            <span>Game data updated to {new Date(data.builtAt).toLocaleDateString()} (game v{data.gameVersion}).</span>
            <button className="btn" onClick={() => update((s) => void (s.seenDataBuild = data.builtAt))}>
              OK
            </button>
          </div>
        )}
        {!save.setupDone ? (
          <Setup
            onDone={() => {
              update((s) => void (s.seenDataBuild = data.builtAt))
              setTab('base')
            }}
          />
        ) : tab === 'rebirth' ? (
          <RebirthView />
        ) : tab === 'base' ? (
          <BaseView />
        ) : tab === 'droids' ? (
          <CollectionView />
        ) : tab === 'tools' ? (
          <ToolsView />
        ) : (
          <SettingsView />
        )}
      </main>

      {save.setupDone && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto grid max-w-3xl grid-cols-5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex flex-col items-center py-2 text-xs ${tab === t.id ? 'readout text-accent' : 'text-dim'}`}
              >
                <span className="relative text-lg leading-none">
                  {t.icon}
                  {t.id === 'settings' && <DataIssuesBadge dot />}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      )}
      <Toasts />
    </div>
  )
}

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const undo = useStore((s) => s.undo)
  const dismiss = useStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="panel pointer-events-auto flex max-w-md items-center gap-3 px-3 py-2 text-sm shadow-lg">
          <span>{t.text}</span>
          {t.undo && (
            <button
              className="btn px-2 py-1 text-xs"
              onClick={() => {
                dismiss(t.id)
                undo()
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
