import { useMemo, useState } from 'react'
import { TIER_LABEL } from '../domain/types.ts'
import { formatAmount, formatDuration } from '../engine/format.ts'
import { computeIncome } from '../engine/income.ts'
import { type NeededItem, neededQueue, stepEtas } from '../engine/plan.ts'
import { applyRebirth, applySuperRebirth, setRebirth } from '../engine/progress.ts'
import { type Coverage, superRebirthEligibility } from '../engine/requirements.ts'
import { unlocksAt } from '../engine/slots.ts'
import { AmountInput, DroidName, Sheet, Stat, Stepper, TierChip } from '../ui/common.tsx'
import { data, defs, useStore } from '../store/store.ts'
import { type ChipStatus, chipEta, chipStatus } from '../engine/chips.ts'
import { scourgeLoss, scourgeWindow } from '../engine/scourge.ts'
import { type CoverKind, recommendStop, superRebirthOptions } from '../engine/superPlan.ts'

export function RebirthView() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const toast = useStore((s) => s.toast)
  const [now] = useState(() => Date.now())
  const [confirm, setConfirm] = useState<null | 'rebirth' | 'super'>(null)
  const [editRebirth, setEditRebirth] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const p = save.profile
  const income = useMemo(() => computeIncome(save, data, defs), [save])
  const etas = useMemo(() => stepEtas(save, data, defs, now), [save, now])
  const queue = useMemo(() => neededQueue(save, data, defs, now), [save, now])
  const sr = useMemo(() => superRebirthEligibility(save, data, defs), [save])
  const chips = useMemo(() => chipStatus(save, data, defs, now), [save, now])
  const loss = useMemo(() => scourgeLoss(save, data, defs), [save])
  // Chip upgrades share one balance, so each one's ETA includes the ones before it in the queue.
  const chipsBefore = useMemo(
    () =>
      queue.reduce<number[]>((acc, _item, i) => {
        const prev = queue[i - 1]?.coverage.find((c) => c.kind === 'upgrade')
        acc.push((acc[i - 1] ?? 0) + (prev?.kind === 'upgrade' ? prev.chips : 0))
        return acc
      }, []),
    [queue],
  )
  const current = etas[0]

  const doRebirth = () => {
    const next = applyRebirth(save, data)
    update(() => next, `Rebirthed to ${next.profile.rebirth}`)
    for (const u of unlocksAt(data, next.profile.rebirth)) toast(`Unlocked: ${u}`)
    toast('Multiplier estimated — check the green number in game and update it in Settings.')
  }
  const doSuper = () => {
    const next = applySuperRebirth(save, defs)
    update(() => next, `Super rebirthed → path ${next.profile.path}`)
    toast('Enter your new multiplier in Settings. Iconics can be reclaimed for 1M each.')
  }

  return (
    <div className="space-y-4">
      <section className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Stat label="Path / Rebirth" value={`P${p.path} · ${p.rebirth}/40`} sub={<button className="underline" onClick={() => setEditRebirth(true)}>edit</button>} />
          <Stat label="Income" value={`${formatAmount(income.calibrated)}/s`} sub={income.factor !== 1 ? `calibrated ×${income.factor.toFixed(2)}` : 'uncalibrated'} />
          <Stat label="Next rebirth" value={current ? formatDuration(current.eta) : '—'} sub={current ? `${formatAmount(current.status.step.credits)} needed` : 'path complete'} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-dim">Credits now</span>
          <AmountInput
            className="w-32"
            value={p.credits}
            placeholder="e.g. 2.5M"
            onCommit={(n) =>
              update((s) => {
                s.profile.credits = n
                s.profile.creditsUpdatedAt = Date.now()
              })
            }
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => (current && current.status.missing === 0 ? doRebirth() : setConfirm('rebirth'))} disabled={p.rebirth >= 40}>
            I rebirthed
          </button>
          <button className="btn" onClick={() => (sr.ok && loss.count === 0 ? doSuper() : setConfirm('super'))}>
            I super rebirthed
          </button>
        </div>
        <SuperEligibility ok={sr.ok} rebirthOk={sr.rebirthOk} droidOk={sr.droidOk} />
      </section>

      <section className="panel p-4">
        <h2 className="heading mb-2 font-bold">Needed next</h2>
        {queue.length === 0 ? (
          <p className="text-ok">Every remaining requirement in this path is covered. 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {queue.slice(0, showAll ? undefined : 8).map((item, i) => (
              <NeededRow key={`${item.req.droidId}@${item.req.tier}`} item={item} chips={chips} chipsBefore={chipsBefore[i]} />
            ))}
          </ul>
        )}
        {queue.length > 8 && (
          <button className="btn mt-2 w-full" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${queue.length}`}
          </button>
        )}
      </section>

      <SuperPlanner now={now} />

      <section className="panel p-4">
        <h2 className="heading mb-2 font-bold">Path {p.path} — remaining rebirths</h2>
        <ol className="space-y-1.5">
          {etas.map(({ status, eta }) => {
            const s = status.step
            const ready = status.missing === 0
            return (
              <li key={s.from}>
                {s.from === data.constants.superRebirth.minRebirth && (
                  <div className="my-1 text-center text-xs text-accent">── super rebirth possible from here ──</div>
                )}
                <div className={`rounded-lg border px-3 py-2 ${ready ? 'border-ok/60 bg-ok/5' : 'border-line'}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="num font-semibold">
                      {s.from}→{s.from + 1}
                    </span>
                    <span className={`text-xs font-bold ${ready ? 'text-ok' : status.missing === 3 ? 'text-dim' : 'text-warn'}`}>
                      {ready ? 'READY' : `MISSING ${status.missing}`}
                    </span>
                    <span className="num text-xs text-dim">
                      {formatAmount(s.credits)} · {formatDuration(eta)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    {status.reqs.map((r) => (
                      <span key={r.req.droidId} className={`inline-flex items-center gap-1 ${r.metBy ? '' : 'opacity-60'}`}>
                        <span aria-label={r.metBy ? 'have' : 'missing'}>{r.metBy ? '✓' : '✗'}</span>
                        <TierChip tier={r.req.tier} />
                        <DroidName id={r.req.droidId} />
                        {r.metBy && r.metBy.how !== 'direct' && <span className="text-xs text-dim">({r.metBy.how})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {confirm && (
        <Sheet title={confirm === 'rebirth' ? 'Rebirth anyway?' : 'Super rebirth anyway?'} onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-dim">
            {confirm === 'rebirth'
              ? `Protocol thinks you're still missing ${current?.status.missing ?? 0} droid(s) for this rebirth. If you rebirthed in game, go ahead — your inventory may just be out of date.`
              : sr.ok
                ? 'Record your super rebirth?'
                : `Protocol doesn't think you meet the super rebirth conditions yet (rebirth ${data.constants.superRebirth.minRebirth}+ and a Legendary Rainbow+ in base). Record it anyway?`}
          </p>
          {confirm === 'super' && loss.count > 0 && <ScourgeWarning count={loss.count} share={loss.share} />}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => {
                setConfirm(null)
                if (confirm === 'rebirth') doRebirth()
                else doSuper()
              }}
            >
              Yes, I did
            </button>
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
      {editRebirth && <EditRebirthSheet onClose={() => setEditRebirth(false)} />}
    </div>
  )
}

function SuperEligibility({ ok, rebirthOk, droidOk }: { ok: boolean; rebirthOk: boolean; droidOk: boolean }) {
  if (ok) return <p className="text-xs text-ok">Super rebirth available.</p>
  return (
    <p className="text-xs text-dim">
      Super rebirth needs: <span className={rebirthOk ? 'text-ok' : ''}>rebirth {data.constants.superRebirth.minRebirth}+ {rebirthOk ? '✓' : '✗'}</span> ·{' '}
      <span className={droidOk ? 'text-ok' : ''}>a Legendary Rainbow+ in base {droidOk ? '✓' : '✗'}</span>
    </p>
  )
}

function EditRebirthSheet({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.save.profile)
  const update = useStore((s) => s.update)
  const [path, setPath] = useState(p.path)
  const [rebirth, setRb] = useState(p.rebirth)
  return (
    <Sheet title="Set path & rebirth" onClose={onClose}>
      <p className="mb-3 text-sm text-dim">Use this if you sped through rebirths without tracking. It doesn't change lifetime rebirths.</p>
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <label className="space-y-1">
          <div className="text-dim">Path</div>
          <Stepper value={path} onChange={setPath} min={1} max={6} />
        </label>
        <label className="space-y-1">
          <div className="text-dim">Rebirth</div>
          <Stepper value={rebirth} onChange={setRb} min={0} max={40} />
        </label>
      </div>
      <button
        className="btn btn-primary"
        onClick={() => {
          update((s) => {
            const n = setRebirth(s, rebirth)
            n.profile.path = path
            return n
          }, `Set to path ${path}, rebirth ${rebirth}`)
          onClose()
        }}
      >
        Save
      </button>
    </Sheet>
  )
}

function NeededRow({ item, chips, chipsBefore }: { item: NeededItem; chips: ChipStatus; chipsBefore: number }) {
  const best = item.coverage[0]
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <TierChip tier={item.req.tier} />
          <DroidName id={item.req.droidId} />
        </span>
        <span className="num shrink-0 text-xs text-dim">
          by R{item.forRebirth} · {formatDuration(item.eta)}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-dim">
        {item.coverage.slice(0, 3).map((c, i) => (
          <li key={i} className={c === best ? 'text-ink' : ''}>
            → {describeCoverage(c, item, chips, chipsBefore)}
          </li>
        ))}
      </ul>
    </li>
  )
}

function describeCoverage(c: Coverage, item: NeededItem, chips: ChipStatus, chipsBefore = 0): string {
  const name = (id: string) => defs.get(id)?.name ?? id
  switch (c.kind) {
    case 'place':
      return c.note
    case 'upgrade':
      if (c.chips === 0 && c.activateKyber) return 'Activate your Kyber copy at the Cantina'
    {
      const eta = chipEta(chipsBefore + c.chips, chips)
      const when = eta === 0 ? 'affordable now' : Number.isFinite(eta) ? `ready in ${formatDuration(eta)}` : 'no chip income yet'
      return `Chip-upgrade your ${TIER_LABEL[c.fromTier]} copy: ${formatAmount(c.chips)} chips (${when})${c.activateKyber ? ' + activate Kyber' : ''}`
    }
    case 'fuseTier':
      return `Fuse ${c.have}/3 ${TIER_LABEL[c.fromTier]} ${name(item.req.droidId)}`
    case 'fusionDroid': {
      const have = c.components.filter((x) => x.have).length
      return `Fusion droid ${name(c.droidId)} (${c.components.map((x) => name(x.droidId)).join(' + ')}): have ${have}/3 at ${TIER_LABEL[item.req.tier]}+`
    }
    case 'craft':
      return c.inProgress ? `Crafting — done in ${formatDuration(c.seconds)}` : `Craft your blueprint: ~${formatDuration(c.seconds)}`
    case 'luck':
      return 'Needs a blueprint drop (luck)'
  }
}

function ScourgeWarning({ count, share }: { count: number; share: number }) {
  const w = scourgeWindow(data)
  return (
    <div className="mb-4 rounded-lg border border-warn/60 bg-warn/5 p-3 text-sm">
      Super rebirthing wipes your <b>{count} Scourge</b> droid(s) (≈{Math.round(share * 100)}% of income).{' '}
      {w.active
        ? `Scourge Friday is live for another ${formatDuration(w.endsIn)}, so it's a good time to rebuild.`
        : `Next Scourge Friday is in ${formatDuration(w.startsIn)}; super rebirthing just before it lets you rebuild sooner.`}
    </div>
  )
}

function SuperPlanner({ now }: { now: number }) {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const opts = useMemo(() => superRebirthOptions(save, data, defs, now), [save, now])
  const best = recommendStop(opts)
  const [open, setOpen] = useState(false)
  if (!opts.length) return null
  const shown = open ? opts : opts.filter((o) => o === best || o === opts[0] || o.level === 40 || (!o.needsLuck && o.level % 4 === 0))
  return (
    <section className="panel space-y-2 p-4">
      <h2 className="heading font-bold">Super rebirth: now or keep going?</h2>
      {best ? (
        <p className="text-sm">
          Best without luck: <b>rebirth {best.level}</b> for <span className="num readout">{best.crystals}</span> crystals
          {best.eta > 0 && <> in ~{formatDuration(best.eta)}</>}
          {best.perHour !== undefined && <> · {best.perHour.toFixed(1)} crystals/h over the run</>}.
        </p>
      ) : (
        <p className="text-sm text-dim">Every stopping point still needs a lucky blueprint drop.</p>
      )}
      {save.profile.runStartedAt === null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          This run started
          <input
            className="num w-16"
            inputMode="decimal"
            placeholder="hours"
            onBlur={(e) => {
              const h = Number(e.target.value)
              if (h > 0) update((s) => void (s.profile.runStartedAt = Date.now() - h * 3600_000), 'Run start set')
            }}
          />
          hours ago. That enables crystals per hour; it's set automatically after your next super rebirth.
        </div>
      )}
      <table className="num w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-dim">
            <th>At</th>
            <th>Crystals</th>
            <th>When</th>
            <th>Droids still needed</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((o) => (
            <tr key={o.level} className={o === best ? 'text-accent' : o.needsLuck ? 'text-dim' : ''}>
              <td>R{o.level}</td>
              <td>
                {o.crystals}
                {o.perHour !== undefined && <span className="text-xs text-dim"> ({o.perHour.toFixed(1)}/h)</span>}
              </td>
              <td>{o.eta === 0 ? 'now' : formatDuration(o.eta)}</td>
              <td className="text-xs">
                {coverText(o.cover)}
                {o.needsLuck && <span className="text-warn"> · stretch</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {opts.length > shown.length || open ? (
        <button className="btn w-full" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show all ${opts.length} stopping points`}
        </button>
      ) : null}
    </section>
  )
}

function coverText(c: Record<CoverKind, number>): string {
  const parts = [
    c.place && `${c.place} to move`,
    c.chips && `${c.chips} chip-able`,
    c.fuse && `${c.fuse} fusable`,
    c.craft && `${c.craft} craftable`,
    c.luck && `${c.luck} need luck`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'none'
}
