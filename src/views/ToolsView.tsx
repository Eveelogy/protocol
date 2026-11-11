import { useMemo, useState } from 'react'
import { uid } from '../domain/save.ts'
import { TIER_LABEL, type Tier } from '../domain/types.ts'
import { cb23Entry, cb23ReadyIn, cb23Stats, missionSeconds, suggestedMissionMinutes } from '../engine/cb23.ts'
import { chipEta, chipStatus, chipsNeeded, stationCandidates } from '../engine/chips.ts'
import { formatAmount, formatDuration } from '../engine/format.ts'
import { applyFusion, fusionSuggestions } from '../engine/fusion.ts'
import { neededQueue } from '../engine/plan.ts'
import { craftSeconds } from '../engine/requirements.ts'
import { scourgeLoss, scourgeWhatIf, scourgeWindow } from '../engine/scourge.ts'
import { AmountInput, DroidName, DroidPicker, Sheet, TierChip, TierPicker } from '../ui/common.tsx'
import { useNow } from '../ui/useNow.ts'
import { data, defs, useStore } from '../store/store.ts'
import { Section } from './SettingsView.tsx'

export function ToolsView() {
  return (
    <div className="space-y-4">
      <Timers />
      <ChipStations />
      <Blueprints />
      <Fusions />
      <Scourge />
      <Cb23 />
    </div>
  )
}

function Timers() {
  const save = useStore((s) => s.save)
  const now = useNow(15_000)
  const sw = scourgeWindow(data, now)
  const chips = chipStatus(save, data, defs, now)
  const cb = cb23ReadyIn(save, now)
  const crafting = save.blueprints.filter((b) => b.crafting)
  const row = (label: string, value: string, hot = false) => (
    <li className="flex items-center justify-between py-1.5 text-sm">
      <span>{label}</span>
      <span className={`num ${hot ? 'readout font-bold text-accent' : 'text-dim'}`}>{value}</span>
    </li>
  )
  return (
    <Section title="Timers" hint="Countdowns update while the app is open. Notifications come later.">
      <ul className="divide-y divide-line">
        {row('Scourge Friday', sw.active ? `LIVE · ends in ${formatDuration(sw.endsIn)}` : `in ${formatDuration(sw.startsIn)}`, sw.active)}
        {chips.stations > 0 && chips.perMinute > 0 && row('Chip stations full', chips.fullIn === 0 ? 'FULL — collect' : `in ${formatDuration(chips.fullIn)}`, chips.fullIn === 0)}
        {save.cb23.length > 0 && row('CB-23 mission', cb === 0 ? 'ready' : `in ${formatDuration(cb)}`, cb === 0)}
        {crafting.map((b) => {
          const left = Math.max(0, b.crafting!.startedAt + b.crafting!.seconds * 1000 - now) / 1000
          return row(`Crafting ${defs.get(b.droidId)?.name} (${TIER_LABEL[b.tier]})`, left === 0 ? 'done' : `in ${formatDuration(left)}`, left === 0)
        })}
      </ul>
    </Section>
  )
}

function ChipStations() {
  const save = useStore((s) => s.save)
  const now = useNow()
  const st = useMemo(() => chipStatus(save, data, defs, now), [save, now])
  const queue = useMemo(() => neededQueue(save, data, defs, now), [save, now])
  const need = chipsNeeded(queue, save.profile.rebirth + 3)
  const needAll = chipsNeeded(queue)
  const cands = useMemo(() => stationCandidates(save, data, defs).slice(0, 5), [save])
  const byUid = new Map(save.droids.map((o) => [o.uid, o]))

  if (st.stations === 0)
    return (
      <Section title="Upgrade chips" hint="Set the Upgrade Chip Station level in Settings → Nova Shop once you've bought it.">
        <ChipBalance />
      </Section>
    )

  return (
    <Section title="Upgrade chips" hint={`${st.stations} station(s) · storage ${st.capacityHours}h${st.doubled ? ' · BB-8 doubling' : ''}. Put droids in stations from the Base tab.`}>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-xs text-dim">Rate</div>
          <div className="num readout font-semibold">{formatAmount(st.perMinute)}/min</div>
        </div>
        <div>
          <div className="text-xs text-dim">Waiting</div>
          <div className="num readout font-semibold">{formatAmount(st.stored)}</div>
        </div>
        <div>
          <div className="text-xs text-dim">Full in</div>
          <div className="num readout font-semibold">{st.perMinute ? (st.fullIn === 0 ? 'full' : formatDuration(st.fullIn)) : '—'}</div>
        </div>
      </div>
      <ChipBalance stored={st.stored} />
      <p className="text-sm">
        Chip upgrades for the next 3 rebirths: <span className="num font-semibold">{formatAmount(need)}</span>
        {need > 0 && <> · affordable {chipEta(need, st) === 0 ? <span className="text-ok">now</span> : <>in <span className="num">{formatDuration(chipEta(need, st))}</span></>}</>}
        <span className="text-dim"> (whole path: {formatAmount(needAll)})</span>
      </p>
      {cands.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Best droids for a station</summary>
          <ul className="mt-1 space-y-1 text-sm">
            {cands.map((c) => {
              const o = byUid.get(c.uid)!
              return (
                <li key={c.uid} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1">
                    <TierChip tier={o.tier} />
                    <DroidName id={o.droidId} />
                    {o.location.kind === 'chip' && <span className="text-xs text-ok">in station</span>}
                  </span>
                  <span className="num text-xs text-dim">
                    {c.perMinute}/min{c.creditsLost > 0 && ` · costs ${formatAmount(c.creditsLost)}/s`}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </Section>
  )
}

function ChipBalance({ stored = 0 }: { stored?: number }) {
  const chips = useStore((s) => s.save.profile.chips)
  const update = useStore((s) => s.update)
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-dim">Chips in hand</span>
      <AmountInput className="w-24" value={chips} onCommit={(n) => update((s) => void (s.profile.chips = n))} />
      <button
        className="btn"
        onClick={() =>
          update((s) => {
            s.profile.chips += Math.floor(stored)
            s.profile.chipsCollectedAt = Date.now()
          }, `Collected ${formatAmount(stored)} chips`)
        }
      >
        I collected
      </button>
    </div>
  )
}

function Blueprints() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const now = useNow(15_000)
  const [adding, setAdding] = useState(false)
  return (
    <Section title="Blueprints & crafting" hint="Blueprints you hold turn a 'needs luck' requirement into a craft time.">
      <ul className="divide-y divide-line">
        {save.blueprints.map((b) => {
          const def = defs.get(b.droidId)
          const base = craftSeconds(def, b.tier, save)
          const left = b.crafting ? Math.max(0, b.crafting.startedAt + b.crafting.seconds * 1000 - now) / 1000 : undefined
          return (
            <li key={b.uid} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
              <span className="inline-flex items-center gap-1">
                <TierChip tier={b.tier} /> <DroidName id={b.droidId} />
              </span>
              <span className="flex items-center gap-2">
                <span className="num text-xs text-dim">
                  {left !== undefined ? (left === 0 ? 'done' : `${formatDuration(left)} left`) : base !== undefined ? `~${formatDuration(base)}` : 'craft time unknown'}
                </span>
                {!b.crafting && (
                  <button
                    className="btn"
                    onClick={() =>
                      update((s) => {
                        const x = s.blueprints.find((y) => y.uid === b.uid)
                        if (x) x.crafting = { startedAt: Date.now(), seconds: base ?? 0 }
                      }, `Crafting ${def?.name}`)
                    }
                  >
                    Start
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    update((s) => {
                      s.blueprints = s.blueprints.filter((y) => y.uid !== b.uid)
                      s.droids.push({ uid: uid(), droidId: b.droidId, tier: b.tier, location: { kind: 'lounge' } })
                    }, `Crafted ${def?.name} → Lounge`)
                  }
                >
                  Crafted
                </button>
                <button className="btn" aria-label="Remove blueprint" onClick={() => update((s) => void (s.blueprints = s.blueprints.filter((y) => y.uid !== b.uid)), 'Removed blueprint')}>
                  ✕
                </button>
              </span>
            </li>
          )
        })}
        {!save.blueprints.length && <li className="py-1.5 text-sm text-dim">No blueprints tracked.</li>}
      </ul>
      <button className="btn" onClick={() => setAdding(true)}>
        + Add blueprint
      </button>
      {adding && <AddBlueprint onClose={() => setAdding(false)} />}
    </Section>
  )
}

function AddBlueprint({ onClose }: { onClose: () => void }) {
  const update = useStore((s) => s.update)
  const [pick, setPick] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier>('default')
  return (
    <Sheet title={pick ? `Blueprint: ${defs.get(pick)?.name}` : 'Add blueprint'} onClose={onClose}>
      {!pick ? (
        <DroidPicker onPick={setPick} noIconics />
      ) : (
        <div className="space-y-4">
          <TierPicker value={tier} onChange={setTier} allowScourge={false} />
          <button
            className="btn btn-primary"
            onClick={() => {
              update((s) => void s.blueprints.push({ uid: uid(), droidId: pick, tier }), `Added ${defs.get(pick)?.name} blueprint`)
              onClose()
            }}
          >
            Add
          </button>
        </div>
      )}
    </Sheet>
  )
}

function Fusions() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const list = useMemo(() => fusionSuggestions(save, data, defs), [save])
  const byUid = new Map(save.droids.map((o) => [o.uid, o]))
  return (
    <Section title="Fusions you can do now" hint="Fusion droids count for their parts' rebirth requirements. Results go to the Lounge.">
      {!list.length ? (
        <p className="text-sm text-dim">Nothing to fuse yet — you need 3 identical droids, or all 3 parts of a fusion recipe.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((f, i) => (
            <li key={i} className="space-y-1 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex flex-wrap items-center gap-1">
                  → <TierChip tier={f.result.tier} /> <DroidName id={f.result.droidId} />
                  {f.helps.length > 0 && <span className="text-xs text-ok">helps rebirth {f.helps.slice(0, 4).join(', ')}</span>}
                  {!f.allSpare && <span className="text-xs text-warn">uses a droid a rebirth needs</span>}
                </span>
                <button className="btn btn-primary" onClick={() => update((s) => applyFusion(s, f, uid()), `Fused ${defs.get(f.result.droidId)?.name}`)}>
                  I fused this
                </button>
              </div>
              <div className="text-xs text-dim">
                uses{' '}
                {f.uses
                  .map((u) => byUid.get(u))
                  .map((o) => `${TIER_LABEL[o!.tier]} ${defs.get(o!.droidId)?.name}`)
                  .join(' + ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Scourge() {
  const save = useStore((s) => s.save)
  const now = useNow()
  const sw = scourgeWindow(data, now)
  const pts = useMemo(() => scourgeWhatIf(save, data, defs, 10), [save])
  const loss = useMemo(() => scourgeLoss(save, data, defs), [save])
  const base = pts[0]?.income ?? 0
  return (
    <Section
      title="Scourge & Hive Mind"
      hint="Hive Mind numbers come from a single community datamine and may be off. Each extra Scourge here replaces your weakest earner with a Scourge copy of it."
    >
      <p className="text-sm">
        {sw.active ? (
          <span className="text-ok">Scourge Friday is live — ends in {formatDuration(sw.endsIn)}.</span>
        ) : (
          <>Next Scourge Friday in <span className="num">{formatDuration(sw.startsIn)}</span>.</>
        )}{' '}
        You have <span className="num">{loss.count}</span> Scourge ({Math.round(loss.share * 100)}% of income).
      </p>
      {pts.length > 1 ? (
        <table className="num w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-dim">
              <th>+Scourge</th>
              <th>Income</th>
              <th>Gain</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.extra} className={p.extra === 0 ? 'text-dim' : ''}>
                <td>{p.extra === 0 ? 'now' : `+${p.extra}`}</td>
                <td>{formatAmount(p.income)}/s</td>
                <td>{p.extra === 0 ? '' : `+${base ? Math.round((p.income / base - 1) * 100) : 0}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-dim">Place earning droids on the Base tab to see what-ifs.</p>
      )}
    </Section>
  )
}

function Cb23() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const now = useNow(15_000)
  const [confirm, setConfirm] = useState<null | 'chips' | 'crystals40' | 'crystals80'>(null)
  const readyIn = cb23ReadyIn(save, now)
  const stats = cb23Stats(save.cb23, data)
  const hint = suggestedMissionMinutes(save.cb23)
  const p = save.profile
  const mult = p.hyperdrive ? 3 : 1
  const log = (r: 'chips' | 'crystals40' | 'crystals80') => {
    update((s) => void s.cb23.push(cb23Entry(s, r, data.gameVersion)), r === 'chips' ? 'Logged CB-23: chips' : `Logged CB-23: ${(r === 'crystals40' ? 40 : 80) * mult} crystals`)
    setConfirm(null)
  }
  const tap = (r: 'chips' | 'crystals40' | 'crystals80') => (readyIn > 0 ? setConfirm(r) : log(r))
  return (
    <Section title="CB-23 secret missions" hint={`Mission length ${formatDuration(missionSeconds(save))}. ${readyIn > 0 ? `Next one in ${formatDuration(readyIn)}.` : 'Ready to log.'}`}>
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => tap('chips')}>
          Chips
        </button>
        <button className="btn btn-primary" onClick={() => tap('crystals40')}>
          Crystals {40 * mult}
        </button>
        <button className="btn btn-primary" onClick={() => tap('crystals80')}>
          Crystals {80 * mult}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-dim">Missions</div>
          <div className="num readout font-semibold">{stats.n}</div>
        </div>
        <div>
          <div className="text-xs text-dim">Crystal rate</div>
          <div className="num readout font-semibold">{stats.n ? `${(stats.rate * 100).toFixed(1)}%` : '—'}</div>
          <div className="text-xs text-dim">community ~{Math.round(stats.community * 100)}%</div>
        </div>
        <div>
          <div className="text-xs text-dim">Crystals earned</div>
          <div className="num readout font-semibold">{stats.crystals}</div>
        </div>
        <div>
          <div className="text-xs text-dim">Per day</div>
          <div className="num readout font-semibold">{stats.perDay !== undefined ? stats.perDay.toFixed(1) : '—'}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-1">
          Mission minutes
          <input className="num w-16" inputMode="numeric" defaultValue={p.cb23MissionMinutes} onBlur={(e) => update((s) => void (s.profile.cb23MissionMinutes = Math.max(1, Number(e.target.value) || 20)))} />
        </label>
        <label className="inline-flex items-center gap-1">
          Speed %
          <input className="num w-14" inputMode="numeric" defaultValue={p.missionSpeedPct} onBlur={(e) => update((s) => void (s.profile.missionSpeedPct = Math.min(90, Math.max(0, Number(e.target.value) || 0))))} />
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={p.hyperdrive} onChange={(e) => update((s) => void (s.profile.hyperdrive = e.target.checked))} /> Hyperdrive (×3)
        </label>
        {hint !== undefined && hint !== p.cb23MissionMinutes && (
          <button className="btn text-xs" onClick={() => update((s) => void (s.profile.cb23MissionMinutes = hint), `Mission length set to ${hint} min`)}>
            Your logs suggest {hint} min — use it
          </button>
        )}
        {save.cb23.length > 0 && (
          <button className="btn text-xs" onClick={() => update((s) => void s.cb23.pop(), 'Removed last CB-23 log')}>
            Undo last log
          </button>
        )}
      </div>
      {confirm && (
        <Sheet title="Log anyway?" onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-dim">Your last mission was logged less than one mission length ago ({formatDuration(readyIn)} to go). Log this one anyway?</p>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => log(confirm)}>
              Log it
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </Section>
  )
}
