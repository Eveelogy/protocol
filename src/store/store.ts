// App state: one Save persisted to IndexedDB (Dexie), with an in-memory undo stack.
import Dexie, { type Table } from 'dexie'
import { create } from 'zustand'
import gameData from '../data/game-data.json'
import { type Save, newSave } from '../domain/save.ts'
import type { GameData } from '../domain/types.ts'
import { indexDefs } from '../engine/requirements.ts'

export const data = gameData as unknown as GameData
export const defs = indexDefs(data)

class ProtocolDb extends Dexie {
  saves!: Table<{ id: string; save: Save; updatedAt: number }, string>
  constructor() {
    super('protocol')
    this.version(1).stores({ saves: 'id' })
  }
}
const db = new ProtocolDb()

interface Toast {
  id: number
  text: string
  undo?: boolean
}

interface State {
  loaded: boolean
  save: Save
  undoStack: { save: Save; label: string }[]
  toasts: Toast[]
  load: () => Promise<void>
  /** Apply a change. `label` shows in an undo toast; omit for silent edits (still undoable). */
  update: (fn: (s: Save) => Save | void, label?: string) => void
  undo: () => void
  toast: (text: string, undo?: boolean) => void
  dismiss: (id: number) => void
  replaceSave: (s: Save) => void
}

let toastId = 0
let persistTimer: ReturnType<typeof setTimeout> | undefined
const persist = (save: Save) => {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    db.saves.put({ id: 'main', save, updatedAt: Date.now() }).catch((e) => console.error('save failed', e))
  }, 150)
}

export const useStore = create<State>((set, get) => ({
  loaded: false,
  save: newSave(),
  undoStack: [],
  toasts: [],
  async load() {
    try {
      const row = await db.saves.get('main')
      if (row) set({ save: migrate(row.save) })
    } catch (e) {
      console.error('load failed', e)
    }
    set({ loaded: true })
  },
  update(fn, label) {
    const prev = get().save
    const draft = structuredClone(prev)
    const next = fn(draft) ?? draft
    set({ save: next, undoStack: [...get().undoStack.slice(-49), { save: prev, label: label ?? 'edit' }] })
    persist(next)
    if (label) get().toast(label, true)
  },
  undo() {
    const stack = get().undoStack
    const last = stack.at(-1)
    if (!last) return
    set({ save: last.save, undoStack: stack.slice(0, -1) })
    persist(last.save)
    get().toast(`Undone: ${last.label}`)
  },
  toast(text, undo) {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-2), { id, text, undo }] })
    setTimeout(() => get().dismiss(id), 5000)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  replaceSave(s) {
    get().update(() => migrate(s), 'Imported save')
  },
}))

/** Fills in fields added after a save was written. */
function migrate(s: Save): Save {
  const base = newSave()
  return { ...base, ...s, profile: { ...base.profile, ...s.profile, overrides: { ...s.profile?.overrides }, ui: { ...base.profile.ui, ...s.profile?.ui } } }
}
