import { type ReactNode, useMemo, useState } from 'react'
import { type Location, type OwnedDroid, uid } from '../domain/save.ts'
import { AREAS, type KyberColor, type Tier, TIERS, tierIndex } from '../domain/types.ts'
import { formatAmount } from '../engine/format.ts'
import { computeIncome } from '../engine/income.ts'
import { bestLayout, isSingle, locKey, moveDroid } from '../engine/layout.ts'
import { slotCounts } from '../engine/slots.ts'
import { DroidName, DroidPicker, Sheet, Stat, TierChip, TierPicker } from '../ui/common.tsx'
import { data, defs, useStore } from '../store/store.ts'

type Target = { loc: Location; occupant?: OwnedDroid }

const AREA_LABEL = { worker: 'Worker', astromech: 'Astromech', battle: 'Battle' } as const

export function BaseView() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const [target, setTarget] = useState<Target | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [plan, setPlan] = useState<ReturnType<typeof bestLayout> | null>(null)

  const counts = useMemo(() => slotCounts(data, save), [save])
  const income = useMemo(() => computeIncome(save, data, defs), [save])
  const incomeByUid = useMemo(() => new Map(income.perDroid.map((x) => [x.uid, x.final * income.factor])), [income])
  const byLoc = useMemo(() => {
    const m = new Map<string, OwnedDroid[]>()
    for (const o of save.droids) {
      const k = locKey(o.location)
      m.set(k, [...(m.get(k) ?? []), o])
    }
    return m
  }, [save.droids])

  const tap = (loc: Location, occupant?: OwnedDroid) => {
    if (moving) {
      const d = save.droids.find((x) => x.uid === moving)
      update((s) => moveDroid(s, moving, loc), `Moved ${defs.get(d?.droidId ?? '')?.name ?? 'droid'}`)
      setMoving(null)
      return
    }
    setTarget({ loc, occupant })
  }
  const drop = (loc: Location) => (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (id) update((s) => moveDroid(s, id, loc), 'Moved droid')
  }

  const tile = (loc: Location, occupant: OwnedDroid | undefined, label: ReactNode, locked?: string) => (
    <button
      key={locKey(loc) + (occupant?.uid ?? '')}
      disabled={!!locked}
      draggable={!!occupant}
      onDragStart={(e) => occupant && e.dataTransfer.setData('text/plain', occupant.uid)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={drop(loc)}
      onClick={() => tap(loc, occupant)}
      className={`min-h-16 rounded-lg border p-2 text-left text-sm transition ${
        moving === occupant?.uid ? 'border-accent ring-2 ring-accent' : moving ? 'border-dashed border-accent/60' : 'border-line hover:border-dim'
      } ${locked ? 'opacity-40' : ''} ${occupant ? `border-l-4 rarity-${defs.get(occupant.droidId)?.rarity}` : ''}`}
    >
      {occupant ? (
        <>
          <DroidName id={occupant.droidId} flawless={occupant.flawless} />
          <div className="mt-1 flex items-center justify-between gap-1">
            <TierChip tier={occupant.tier} kyber={occupant.kyber} />
            {incomeByUid.has(occupant.uid) && <span className="num text-xs text-dim">{formatAmount(incomeByUid.get(occupant.uid)!)}/s</span>}
          </div>
        </>
      ) : (
        <span className="text-dim">{locked ?? label}</span>
      )}
    </button>
  )

  const loungeDroids = byLoc.get('lounge') ?? []
  const storage = byLoc.get('storage') ?? []

  return (
    <div className="space-y-4">
      <section className="panel flex flex-wrap items-end justify-between gap-3 p-4">
        <Stat label="Base income" value={`${formatAmount(income.calibrated)}/s`} sub={income.hiveMembers ? `Hive Mind: ${income.hiveMembers} Scourge${income.primePlaced ? ' + Prime' : ''}` : undefined} />
        <div className="flex gap-2">
          <button className="btn" onClick={() => setPlan(bestLayout(save, data, defs))}>
            Best layout
          </button>
        </div>
      </section>

      {moving && (
        <div className="sticky top-14 z-30 flex items-center justify-between rounded-lg border border-accent bg-panel p-2 text-sm">
          <span>Tap where {defs.get(save.droids.find((x) => x.uid === moving)?.droidId ?? '')?.name} should go (swaps if occupied).</span>
          <button className="btn" onClick={() => setMoving(null)}>
            Cancel
          </button>
        </div>
      )}

      {AREAS.map((area) => (
        <section key={area} className="panel p-4">
          <h2 className="heading mb-2 font-bold">
            {AREA_LABEL[area]} <span className="num text-xs text-dim">{counts.areas[area]} slots</span>
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: Math.max(counts.areas[area], highestIndex(save.droids, area) + 1) }, (_, i) => {
              const loc: Location = { kind: 'slot', area, index: i }
              return tile(loc, byLoc.get(locKey(loc))?.[0], '+ add', i >= counts.areas[area] ? undefined : undefined)
            })}
          </div>
        </section>
      ))}

      <section className="panel p-4">
        <h2 className="heading mb-2 font-bold">Protocol</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.constants.protocolSlots.map((ps) => {
            const loc: Location = { kind: 'protocol', slotId: ps.id }
            const unlocked = counts.protocol.includes(ps.id)
            return (
              <div key={ps.id}>
                <div className="mb-1 text-xs text-dim">
                  {AREA_LABEL[ps.area]} {ps.kind}
                </div>
                {tile(loc, byLoc.get(locKey(loc))?.[0], '+ add', unlocked ? undefined : `Unlocks at rebirth ${ps.unlockAt}`)}
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="heading mb-2 font-bold">
          Lounge{' '}
          <span className={`num text-xs ${loungeDroids.length > counts.lounge ? 'text-bad' : 'text-dim'}`}>
            {loungeDroids.length}/{counts.lounge}
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {loungeDroids.map((o) => tile({ kind: 'lounge' }, o, ''))}
          {loungeDroids.length < counts.lounge && tile({ kind: 'lounge' }, undefined, '+ add')}
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="heading mb-2 font-bold">Chip stations & companion</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[0, 1].map((n) => {
            const loc: Location = { kind: 'chip', station: n }
            return (
              <div key={n}>
                <div className="mb-1 text-xs text-dim">Chip station {n + 1}</div>
                {tile(loc, byLoc.get(locKey(loc))?.[0], '+ add', n < counts.chipStations ? undefined : 'Buy in Nova Shop')}
              </div>
            )
          })}
          <div>
            <div className="mb-1 text-xs text-dim">Companion</div>
            {tile({ kind: 'companion' }, byLoc.get('companion')?.[0], '+ add')}
          </div>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="heading mb-2 font-bold">
          Storage <span className="num text-xs text-dim">{storage.length}</span>
        </h2>
        <p className="mb-2 text-xs text-dim">Droids here don't count for rebirths and earn nothing.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {storage.map((o) => tile({ kind: 'storage' }, o, ''))}
          {tile({ kind: 'storage' }, undefined, '+ add')}
        </div>
      </section>

      {target && (
        <SlotSheet
          target={target}
          onClose={() => setTarget(null)}
          onMove={(id) => {
            setTarget(null)
            setMoving(id)
          }}
        />
      )}
      {plan && (
        <Sheet title="Best layout" onClose={() => setPlan(null)}>
          <p className="mb-2 text-sm">
            Income <span className="num">{formatAmount(plan.before)}/s</span> → <span className="num readout font-bold">{formatAmount(plan.after)}/s</span>
            <span className="text-dim"> · {plan.movedCount} droid(s) move</span>
          </p>
          <p className="mb-4 text-xs text-dim">
            Highest earners go in matching slots. Droids your remaining rebirths need go to the Lounge. Protocol, chip station and companion
            placements are left alone. Hive Mind is only estimated while choosing.
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              disabled={plan.movedCount === 0}
              onClick={() => {
                update((s) => ({ ...s, droids: plan.droids }), 'Applied best layout')
                setPlan(null)
              }}
            >
              Apply
            </button>
            <button className="btn" onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

const highestIndex = (droids: OwnedDroid[], area: string) =>
  droids.reduce((m, o) => (o.location.kind === 'slot' && o.location.area === area ? Math.max(m, o.location.index) : m), -1)

function SlotSheet({ target, onClose, onMove }: { target: Target; onClose: () => void; onMove: (uid: string) => void }) {
  const update = useStore((s) => s.update)
  const live = useStore((s) => (target.occupant ? s.save.droids.find((x) => x.uid === target.occupant!.uid) : undefined))
  const [pick, setPick] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier>('default')

  if (live) {
    const def = defs.get(live.droidId)
    const set = (patch: Partial<OwnedDroid>, label?: string) =>
      update((s) => {
        const d = s.droids.find((x) => x.uid === live.uid)
        if (d) Object.assign(d, patch)
      }, label)
    const step = (dir: 1 | -1) => {
      const i = tierIndex(live.tier) + dir
      if (i >= 0 && i < TIERS.length) set({ tier: TIERS[i] }, `${def?.name} → ${TIERS[i]}`)
    }
    const to = (loc: Location, label: string) => {
      update((s) => {
        const d = s.droids.find((x) => x.uid === live.uid)
        if (d) d.location = loc
      }, label)
      onClose()
    }
    return (
      <Sheet title={def?.name ?? live.droidId} onClose={onClose}>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <button className="btn px-3" onClick={() => step(-1)} aria-label="Lower tier">
              −
            </button>
            <TierChip tier={live.tier} kyber={live.kyber} />
            <button className="btn px-3" onClick={() => step(1)} aria-label="Raise tier">
              +
            </button>
            <label className="ml-auto inline-flex items-center gap-1">
              <input type="checkbox" checked={!!live.flawless} onChange={(e) => set({ flawless: e.target.checked })} /> Flawless ★
            </label>
          </div>
          <TierPicker value={live.tier} onChange={(t) => set({ tier: t }, `${def?.name} → ${t}`)} />
          {live.tier === 'kyber' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-dim">Kyber:</span>
              {(['inactive', 'green', 'blue', 'purple'] as KyberColor[]).map((k) => (
                <button key={k} className={`btn ${(live.kyber ?? 'inactive') === k ? 'btn-primary' : ''}`} onClick={() => set({ kyber: k })}>
                  {k}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => onMove(live.uid)}>
              Move / swap…
            </button>
            {live.location.kind !== 'lounge' && (
              <button className="btn" onClick={() => to({ kind: 'lounge' }, `${def?.name} → Lounge`)}>
                To Lounge
              </button>
            )}
            {live.location.kind !== 'storage' && (
              <button className="btn" onClick={() => to({ kind: 'storage' }, `${def?.name} → storage`)}>
                To storage
              </button>
            )}
            <button
              className="btn text-bad"
              onClick={() => {
                update((s) => ({ ...s, droids: s.droids.filter((x) => x.uid !== live.uid) }), `Removed ${def?.name}`)
                onClose()
              }}
            >
              Remove (sold/fused)
            </button>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={pick ? `Add ${defs.get(pick)?.name}` : 'Add droid'} onClose={onClose}>
      {!pick ? (
        <DroidPicker
          onPick={setPick}
          filterClass={target.loc.kind === 'protocol' ? 'protocol' : target.loc.kind === 'slot' ? target.loc.area : undefined}
        />
      ) : (
        <div className="space-y-4">
          <TierPicker value={tier} onChange={setTier} />
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => {
                const loc = target.loc
                update((s) => {
                  if (isSingle(loc)) for (const o of s.droids) if (locKey(o.location) === locKey(loc)) o.location = { kind: 'storage' }
                  s.droids.push({ uid: uid(), droidId: pick, tier, location: loc })
                }, `Added ${defs.get(pick)?.name}`)
                onClose()
              }}
            >
              Add
            </button>
            <button className="btn" onClick={() => setPick(null)}>
              Back
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
