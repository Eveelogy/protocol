import { useState } from 'react'
import { useStore } from '../store/store.ts'
import { MultiplierSettings, NovaSettings, ProgressSettings, WorkshopSettings } from './SettingsView.tsx'

const STEPS = [
  { title: 'Where are you?', body: <ProgressSettings /> },
  { title: 'Nova Shop', body: <NovaSettings /> },
  { title: 'Multiplier', body: <MultiplierSettings /> },
  { title: 'Workshop', body: <WorkshopSettings /> },
] as const

export function Setup({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const update = useStore((s) => s.update)
  const finish = () => {
    update((s) => void (s.setupDone = true))
    onDone()
  }
  const last = i === STEPS.length - 1
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="heading text-xs text-dim">
          Setup · step {i + 1} of {STEPS.length + 1}
        </div>
        <h1 className="heading text-xl font-bold">{STEPS[i].title}</h1>
        <p className="text-sm text-dim">
          You can change all of this later in Settings. The last step is entering your droids on the Base screen, area by area.
        </p>
      </div>
      {STEPS[i].body}
      <div className="flex justify-between">
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
          Back
        </button>
        <div className="flex gap-2">
          <button className="btn" onClick={finish}>
            Skip setup
          </button>
          <button className="btn btn-primary" onClick={() => (last ? finish() : setI(i + 1))}>
            {last ? 'Next: enter droids →' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
