import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { type DroidClass, type KyberColor, type Tier, CLASSES, TIER_LABEL, TIERS } from '../domain/types.ts'
import { formatAmount, parseAmountInput } from '../engine/format.ts'
import { data, defs, useStore } from '../store/store.ts'

export function TierChip({ tier, kyber }: { tier: Tier; kyber?: string }) {
  const label = tier === 'kyber' && kyber && kyber !== 'inactive' ? `Kyber · ${kyber}` : TIER_LABEL[tier]
  return <span className={`tier tier-${tier}`}>{label}</span>
}

const KYBER_COLORS: KyberColor[] = ['inactive', 'green', 'blue', 'purple']

/** Kyber activation colour. Inactive Kyber droids don't count for Kyber rebirth requirements. */
export function KyberPicker({ value, onChange }: { value: KyberColor | undefined; onChange: (k: KyberColor) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-dim">Kyber colour:</span>
      {KYBER_COLORS.map((k) => (
        <button key={k} className={`btn capitalize ${(value ?? 'inactive') === k ? 'btn-primary' : ''}`} onClick={() => onChange(k)} aria-pressed={(value ?? 'inactive') === k}>
          {k}
        </button>
      ))}
    </div>
  )
}

/** Iconic droids have no tiers and you can own only one of each. */
export const isIconic = (droidId: string) => defs.get(droidId)?.rarity === 'iconic'

/** Tier chip for an owned droid; Iconics show an "Iconic" badge instead of a tier. */
export function OwnedTier({ droidId, tier, kyber }: { droidId: string; tier: Tier; kyber?: string }) {
  if (isIconic(droidId)) return <span className="tier tier-iconic">Iconic</span>
  return <TierChip tier={tier} kyber={kyber} />
}

const CLASS_GLYPH: Record<DroidClass, string> = { worker: '⚙', astromech: '◉', battle: '⚔', protocol: '◈' }
export const ClassGlyph = ({ cls }: { cls: DroidClass }) => (
  <span title={cls} aria-label={cls} className="text-dim">
    {CLASS_GLYPH[cls]}
  </span>
)

export function DroidName({ id, flawless }: { id: string; flawless?: boolean }) {
  const d = defs.get(id)
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      {d && <ClassGlyph cls={d.class} />}
      {d?.name ?? id}
      {flawless && <span title="Flawless" className="text-accent">★</span>}
      {d?.incomplete && <span title="Missing data — fill in data/supplements/droids.json" className="text-warn">?</span>}
    </span>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="panel max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-4 sm:rounded-b-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="heading text-lg font-bold">{title}</h2>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, max = 999, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label?: string }) {
  return (
    <div className="inline-flex items-center gap-1" aria-label={label}>
      <button className="btn px-3" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="decrease">
        −
      </button>
      <input
        className="num w-14 text-center"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))))
        }}
      />
      <button className="btn px-3" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="increase">
        +
      </button>
    </div>
  )
}

/** Text input for big numbers like "5.35M". Commits on blur / Enter. */
export function AmountInput({ value, onCommit, placeholder, className = '' }: { value: number; onCommit: (n: number) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value ? formatAmount(value) : '')
  useEffect(() => setText(value ? formatAmount(value) : ''), [value])
  const commit = () => {
    if (!text.trim()) return onCommit(0)
    const n = parseAmountInput(text)
    if (Number.isFinite(n)) onCommit(n)
    else setText(value ? formatAmount(value) : '')
  }
  return (
    <input
      className={`num ${className}`}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function TierPicker({ value, onChange, allowScourge = true }: { value: Tier; onChange: (t: Tier) => void; allowScourge?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TIERS.filter((t) => allowScourge || t !== 'scourge').map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          // inline-flex + leading-none so the ring hugs the chip evenly (no text line-height below it)
          className={`inline-flex items-center justify-center rounded-lg p-[3px] leading-none ${value === t ? 'ring-2 ring-accent' : 'opacity-70 hover:opacity-100'}`}
          aria-pressed={value === t}
        >
          <TierChip tier={t} />
        </button>
      ))}
    </div>
  )
}

export function DroidPicker({ onPick, filterClass, noIconics }: { onPick: (id: string) => void; filterClass?: DroidClass; noIconics?: boolean }) {
  const [q, setQ] = useState('')
  const [cls, setCls] = useState<DroidClass | 'all'>(filterClass ?? 'all')
  const owned = useStore((s) => s.save.droids)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.droids.filter((d) => (cls === 'all' || d.class === cls) && (!s || d.name.toLowerCase().includes(s)) && !(noIconics && d.rarity === 'iconic'))
  }, [q, cls, noIconics])
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input autoFocus className="flex-1" placeholder="Search droids…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cls} onChange={(e) => setCls(e.target.value as DroidClass | 'all')}>
          <option value="all">All</option>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto">
        {list.map((d) => (
          <li key={d.id}>
            <button className={`flex w-full items-center justify-between border-l-4 px-2 py-2 text-left hover:bg-panel-2 rarity-${d.rarity}`} onClick={() => onPick(d.id)}>
              <DroidName id={d.id} />
              <span className="text-xs text-dim">
                {d.rarity}
                {d.rarity === 'iconic' && owned.some((o) => o.droidId === d.id) && <span className="text-accent"> · owned</span>}
              </span>
            </button>
          </li>
        ))}
        {!list.length && <li className="p-2 text-dim">No droids match.</li>}
      </ul>
    </div>
  )
}

export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div>
    <div className="heading text-xs text-dim">{label}</div>
    <div className="num readout text-lg font-semibold">{value}</div>
    {sub && <div className="text-xs text-dim">{sub}</div>}
  </div>
)
