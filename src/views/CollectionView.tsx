import { useMemo, useState } from 'react'
import { type Location, type OwnedDroid, uid } from '../domain/save.ts'
import { CLASSES, type DroidClass, type Tier, TIERS, tierIndex } from '../domain/types.ts'
import { neededQueue } from '../engine/plan.ts'
import { DroidName, OwnedTier, Sheet, TierChip, TierPicker } from '../ui/common.tsx'
import { data, defs, useStore } from '../store/store.ts'
import { formatDuration } from '../engine/format.ts'

const locLabel = (l: Location) =>
  l.kind === 'slot' ? `${l.area} slot ${l.index + 1}` : l.kind === 'protocol' ? `protocol (${l.slotId})` : l.kind === 'chip' ? `chip station ${l.station + 1}` : l.kind

export function CollectionView() {
  const save = useStore((s) => s.save)
  const update = useStore((s) => s.update)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(true)
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const byDroid = useMemo(() => {
    const m = new Map<string, OwnedDroid[]>()
    for (const o of save.droids) m.set(o.droidId, [...(m.get(o.droidId) ?? []), o])
    return m
  }, [save.droids])
  const needed = useMemo(() => {
    const m = new Map<string, { tier: Tier; forRebirth: number; eta: number }>()
    for (const n of neededQueue(save, data, defs, now)) if (!m.has(n.req.droidId)) m.set(n.req.droidId, { tier: n.req.tier, forRebirth: n.forRebirth, eta: n.eta })
    return m
  }, [save, now])

  const list = data.droids.filter((d) => {
    if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false
    if (ownedOnly && !byDroid.has(d.id)) return false
    return true
  })
  const groups: [string, typeof list][] = group ? CLASSES.map((c) => [c, list.filter((d) => d.class === c)] as [DroidClass, typeof list]) : [['All droids', list]]

  const highest = (id: string) => byDroid.get(id)?.reduce((best, o) => (tierIndex(o.tier) > tierIndex(best.tier) ? o : best))

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <input className="min-w-40 flex-1" placeholder="Search droids…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> By class
        </label>
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> Owned only
        </label>
      </div>
      {groups.map(([name, items]) =>
        items.length ? (
          <section key={name} className="panel p-4">
            <h2 className="heading mb-2 font-bold capitalize">
              {name} <span className="num text-xs text-dim">{items.length}</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {items.map((d) => {
                const top = highest(d.id)
                const need = needed.get(d.id)
                const copies = byDroid.get(d.id) ?? []
                return (
                  <div key={d.id} className={`flex items-center gap-2 rounded-lg border border-line border-l-4 p-2 rarity-${d.rarity}`}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(d.id)}>
                      <div className="flex items-center gap-2">
                        <DroidName id={d.id} flawless={copies.some((c) => c.flawless)} />
                        {copies.length > 1 && <span className="num text-xs text-dim">×{copies.length}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-dim">
                        {top ? <OwnedTier droidId={top.droidId} tier={top.tier} kyber={top.kyber} /> : <span>not owned</span>}
                        {top && <span>· {locLabel(top.location)}</span>}
                        {need && (
                          <span className="text-warn">
                            · need <TierChip tier={need.tier} /> by R{need.forRebirth} ({formatDuration(need.eta)})
                          </span>
                        )}
                      </div>
                    </button>
                    {top && d.rarity === 'iconic' ? null : top ? (
                      <div className="flex shrink-0 gap-1">
                        <TierStep o={top} dir={-1} />
                        <TierStep o={top} dir={1} />
                      </div>
                    ) : (
                      <button
                        className="btn shrink-0"
                        onClick={() => update((s) => void s.droids.push({ uid: uid(), droidId: d.id, tier: 'default', location: { kind: 'lounge' } }), `Added ${d.name} to Lounge`)}
                      >
                        + Own
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ) : null,
      )}
      {open && <CopiesSheet droidId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function TierStep({ o, dir }: { o: OwnedDroid; dir: 1 | -1 }) {
  const update = useStore((s) => s.update)
  const i = tierIndex(o.tier) + dir
  const t = TIERS[i]
  return (
    <button
      className="btn px-2.5"
      disabled={!t}
      aria-label={dir > 0 ? 'Raise tier' : 'Lower tier'}
      onClick={() =>
        update((s) => {
          const d = s.droids.find((x) => x.uid === o.uid)
          if (d && t) d.tier = t
        }, `${defs.get(o.droidId)?.name} → ${t}`)
      }
    >
      {dir > 0 ? '+' : '−'}
    </button>
  )
}

function CopiesSheet({ droidId, onClose }: { droidId: string; onClose: () => void }) {
  // Select the stable array and filter here: a selector that returns a new array each time loops forever.
  const droids = useStore((s) => s.save.droids)
  const copies = useMemo(() => droids.filter((o) => o.droidId === droidId), [droids, droidId])
  const update = useStore((s) => s.update)
  const [tier, setTier] = useState<Tier>('default')
  const def = defs.get(droidId)!
  const iconic = def.rarity === 'iconic'
  const add = (location: Location, where: string) =>
    update((s) => void s.droids.push({ uid: uid(), droidId, tier: iconic ? 'default' : tier, location }), `Added ${def.name} to ${where}`)
  const fusionUses = data.droids.filter((d) => d.fusionOf?.includes(droidId))
  return (
    <Sheet title={def.name} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="text-dim">
          {def.rarity} · {def.class}
          {def.fusionOf && <> · fusion of {def.fusionOf.map((x) => defs.get(x)?.name ?? x).join(' + ')}</>}
        </div>
        {fusionUses.length > 0 && <div className="text-dim">Used in fusions: {fusionUses.map((d) => d.name).join(', ')}</div>}
        <ul className="divide-y divide-line">
          {copies.map((o) => (
            <li key={o.uid} className="flex items-center justify-between py-1.5">
              <span className="inline-flex items-center gap-2">
                <OwnedTier droidId={o.droidId} tier={o.tier} kyber={o.kyber} /> {o.flawless && '★'} <span className="text-dim">{locLabel(o.location)}</span>
              </span>
              <button className="btn text-bad" onClick={() => update((s) => ({ ...s, droids: s.droids.filter((x) => x.uid !== o.uid) }), `Removed ${def.name}`)}>
                Remove
              </button>
            </li>
          ))}
          {!copies.length && <li className="py-1.5 text-dim">You don't own this droid.</li>}
        </ul>
        {iconic && copies.length > 0 ? (
          <p className="text-xs text-dim">Iconics have no tiers and you can only own one. Use the Base tab to move it into a slot.</p>
        ) : (
          <div className="space-y-2">
            <div className="heading text-xs text-dim">{iconic ? 'Add it' : 'Add a copy'}</div>
            {iconic ? <p className="text-xs text-dim">Iconics have no tiers.</p> : <TierPicker value={tier} onChange={setTier} />}
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => add({ kind: 'lounge' }, 'Lounge')}>
                Add to Lounge
              </button>
              <button className="btn" onClick={() => add({ kind: 'storage' }, 'storage')}>
                Add to storage
              </button>
            </div>
            <p className="text-xs text-dim">Use the Base tab to place droids in specific slots.</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
