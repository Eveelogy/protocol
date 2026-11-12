import { useMemo, useRef, useState } from 'react'
import { type Save, newSave } from '../domain/save.ts'
import { formatAmount } from '../engine/format.ts'
import { computeIncome } from '../engine/income.ts'
import { slotCounts } from '../engine/slots.ts'
import { AmountInput, Stepper } from '../ui/common.tsx'
import { DataIssuesBadge } from '../ui/DataIssues.tsx'
import { data, defs, useStore } from '../store/store.ts'

export const Section = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => (
  <section className="panel space-y-3 p-4">
    <div>
      <h2 className="heading font-bold">{title}</h2>
      {hint && <p className="text-xs text-dim">{hint}</p>}
    </div>
    {children}
  </section>
)

export function ProgressSettings() {
  const p = useStore((s) => s.save.profile)
  const update = useStore((s) => s.update)
  const set = (fn: (pr: Save['profile']) => void) => update((s) => void fn(s.profile))
  return (
    <Section title="Progress" hint="Your current rebirth path is shown at the top right of the in-game rebirth screen.">
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="space-y-1">
          <div className="text-dim">Current path (1–6)</div>
          <Stepper value={p.path} min={1} max={6} onChange={(n) => set((x) => void (x.path = n))} />
        </label>
        <label className="space-y-1">
          <div className="text-dim">Current rebirth (0–40)</div>
          <Stepper value={p.rebirth} min={0} max={40} onChange={(n) => set((x) => void (x.rebirth = n))} />
        </label>
        <label className="space-y-1">
          <div className="text-dim">Lifetime rebirths</div>
          <Stepper value={p.lifetimeRebirths} max={100000} onChange={(n) => set((x) => void (x.lifetimeRebirths = n))} />
        </label>
        <label className="space-y-1">
          <div className="text-dim">Super rebirths before tracking (blank = unknown)</div>
          <input
            className="num w-24"
            inputMode="numeric"
            value={p.superRebirthsBefore ?? ''}
            onChange={(e) => set((x) => void (x.superRebirthsBefore = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0)))}
          />
          <div className="text-xs text-dim">Tracked since: {p.superRebirthsTracked}</div>
        </label>
      </div>
    </Section>
  )
}

export function MultiplierSettings() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const toast = useStore((s) => s.toast)
  const inc = useMemo(() => computeIncome(save, data, defs), [save])
  const [actual, setActual] = useState(0)
  return (
    <Section title="Multiplier & calibration" hint="The income formula is a community estimate. Enter your real numbers and Protocol corrects itself.">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-dim">In-game multiplier (green number under credits)</span>
        <input
          className="num w-24"
          inputMode="decimal"
          defaultValue={save.profile.multiplier}
          key={save.profile.multiplier}
          onBlur={(e) => {
            const n = Number(e.target.value.replace(/x/i, ''))
            if (n > 0) update((s) => void (s.profile.multiplier = n), `Multiplier set to ×${n}`)
          }}
        />
      </label>
      <div className="text-sm">
        Predicted: <span className="num">{formatAmount(inc.total)}/s</span> · factor <span className="num">×{inc.factor.toFixed(3)}</span> ({save.profile.calibration.length} samples)
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-dim">Actual credits/s in game</span>
        <AmountInput className="w-28" value={actual} onCommit={setActual} placeholder="e.g. 1.2M" />
        <button
          className="btn"
          disabled={!actual || !inc.total}
          onClick={() => {
            update((s) => void s.profile.calibration.push({ at: Date.now(), predicted: inc.total, actual }), 'Added calibration sample')
            setActual(0)
          }}
        >
          Add sample
        </button>
        {save.profile.calibration.length > 0 && (
          <button
            className="btn"
            onClick={() => {
              update((s) => void (s.profile.calibration = []), 'Cleared calibration')
              toast('Calibration cleared')
            }}
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-xs text-dim">Add a sample after your base is entered and matches the game. Samples older than your last 5 are ignored.</p>
    </Section>
  )
}

export function NovaSettings() {
  const nova = useStore((s) => s.save.profile.nova)
  const update = useStore((s) => s.update)
  const sections = useMemo(() => [...new Set(data.nova.map((n) => n.section))], [])
  return (
    <Section title="Nova Shop upgrades" hint="Set the level you've bought of each upgrade (0 = not bought). Lounge slots and chip stations feed straight into the base.">
      {sections.map((sec) => (
        <details key={sec} className="rounded-lg border border-line p-2" open={sec === sections[0]}>
          <summary className="heading cursor-pointer text-sm font-semibold">{sec}</summary>
          <ul className="mt-2 space-y-1.5">
            {data.nova
              .filter((n) => n.section === sec)
              .map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {n.name}
                    <span className="text-xs text-dim"> · max {n.unlimited ? '∞' : n.costs.length}</span>
                  </span>
                  <Stepper value={nova[n.id] ?? 0} max={n.unlimited ? 999 : n.costs.length} onChange={(v) => update((s) => void (s.profile.nova[n.id] = v))} />
                </li>
              ))}
          </ul>
        </details>
      ))}
    </Section>
  )
}

export function WorkshopSettings() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const counts = slotCounts(data, save)
  const o = save.profile.overrides
  return (
    <Section
      title="Workshop & slots"
      hint="Earning slots come from your rebirth (the wiki's unlock list is partly outdated). If the game shows a different number, use − / + on that area in the Base tab: it's saved from your current rebirth on."
    >
      <label className="flex items-center gap-2 text-sm">
        <span className="text-dim">Total crafting speed bonus %</span>
        <input
          className="num w-20"
          inputMode="numeric"
          defaultValue={save.profile.craftSpeedPct}
          onBlur={(e) => update((s) => void (s.profile.craftSpeedPct = Math.max(0, Number(e.target.value) || 0)))}
        />
      </label>
      <div className="text-sm">
        Now: <span className="num">{counts.areas.worker}</span> worker · <span className="num">{counts.areas.astromech}</span> astromech ·{' '}
        <span className="num">{counts.areas.battle}</span> battle · <span className="num">{counts.lounge}</span> lounge
      </div>
      {save.profile.slotFixes.length > 0 && (
        <div className="space-y-1 text-sm">
          <div className="heading text-xs text-dim">Your slot corrections</div>
          <ul className="divide-y divide-line">
            {[...save.profile.slotFixes]
              .sort((a, b) => a.level - b.level)
              .map((f) => (
                <li key={f.at} className="flex items-center justify-between py-1">
                  <span>
                    {f.delta > 0 ? '+1' : '−1'} {f.area} from rebirth {f.level}
                  </span>
                  <button className="btn px-2 text-xs" onClick={() => update((s) => void (s.profile.slotFixes = s.profile.slotFixes.filter((x) => x.at !== f.at)), 'Removed slot correction')}>
                    Remove
                  </button>
                </li>
              ))}
          </ul>
          <p className="text-xs text-dim">These teach Protocol where the wiki is wrong. Share them and they can go into the game data for everyone.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(['lounge'] as const).map((k) => (
          <label key={k} className="space-y-1">
            <div className="capitalize text-dim">
              {k} slots {o.slots?.[k] !== undefined && <span className="text-warn">(override)</span>}
            </div>
            <div className="flex items-center gap-1">
              <Stepper
                value={k === 'lounge' ? counts.lounge : counts.areas[k]}
                max={40}
                onChange={(n) =>
                  update((s) => {
                    s.profile.overrides.slots = { ...s.profile.overrides.slots, [k]: n }
                  })
                }
              />
              {o.slots?.[k] !== undefined && (
                <button
                  className="btn px-2 text-xs"
                  onClick={() =>
                    update((s) => {
                      const next = { ...s.profile.overrides.slots }
                      delete next[k]
                      s.profile.overrides.slots = next
                    })
                  }
                >
                  auto
                </button>
              )}
            </div>
          </label>
        ))}
      </div>
    </Section>
  )
}

export function SettingsView() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const replaceSave = useStore((s) => s.replaceSave)
  const toast = useStore((s) => s.toast)
  const file = useRef<HTMLInputElement>(null)

  const exportSave = () => {
    const blob = new Blob([JSON.stringify(save, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `protocol-save-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importSave = async (f: File) => {
    try {
      const s = JSON.parse(await f.text()) as Save
      if (s.version !== 1 || !s.profile || !Array.isArray(s.droids)) throw new Error('not a Protocol save')
      replaceSave(s)
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-4">
      <ProgressSettings />
      <MultiplierSettings />
      <WorkshopSettings />
      <NovaSettings />
      <Section title="Look">
        <div className="flex gap-2">
          {(['clean', 'terminal'] as const).map((m) => (
            <button key={m} className={`btn capitalize ${save.profile.ui.retro === m ? 'btn-primary' : ''}`} onClick={() => update((s) => void (s.profile.ui.retro = m))}>
              {m}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Save data" hint="Your progress lives only in this browser. Export it now and then as a backup or to move devices.">
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={exportSave}>
            Export save
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            Import save
          </button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importSave(e.target.files[0])} />
          <button className="btn" onClick={() => update((s) => void (s.setupDone = false))}>
            Re-run setup
          </button>
          <button
            className="btn text-bad"
            onClick={() => {
              if (confirm('Erase all Protocol data in this browser? (You can undo right after.)')) update(() => newSave(), 'Reset everything')
            }}
          >
            Reset all
          </button>
        </div>
      </Section>
      <Section title="Game data">
        <DataIssuesBadge />
        <ul className="space-y-1 text-sm">
          <li>
            Data built <span className="num">{new Date(data.builtAt).toLocaleString()}</span> · game <span className="num">v{data.gameVersion}</span>
          </li>
          <li>
            {data.droids.length} droids · {data.rebirths.length} rebirth steps · {data.nova.length} Nova upgrades
          </li>
          <li>
            {data.droids.filter((d) => d.incomplete).length} droids missing data:{' '}
            <span className="text-dim">
              {data.droids
                .filter((d) => d.incomplete)
                .map((d) => d.name)
                .join(', ') || 'none'}
            </span>
          </li>
          <li>
            {data.disputes.length} disputed values · {data.warnings.length} build warnings
          </li>
          {data.inconsistencies.length > 0 && (
            <li>
              <details>
                <summary className="cursor-pointer">{data.inconsistencies.length} places where sources disagree</summary>
                <ul className="mt-1 list-disc pl-5 text-xs text-dim">
                  {data.inconsistencies.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </details>
            </li>
          )}
          <li className="text-xs text-dim">
            Game data is compiled from the community: the{' '}
            <a className="underline" href="https://star-wars-droid-tycoon.fandom.com/" target="_blank" rel="noreferrer">
              Fandom wiki
            </a>{' '}
            (CC BY-SA),{' '}
            {data.sources
              .filter((s) => !s.id.startsWith('wiki:'))
              .map((s, i, all) => (
                <span key={s.id}>
                  <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  {i < all.length - 1 ? ', ' : ''}
                </span>
              ))}
            , community charts, and hand-written fixes. Where they disagree, the majority wins and the disagreement is listed above. Thanks to everyone who maintains
            them. Protocol is a fan project, not affiliated with the game's makers.
          </li>
        </ul>
      </Section>
    </div>
  )
}
