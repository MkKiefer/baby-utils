import { toast } from '@/composables/useToast'
import type { NewDiaper } from './logic/repo'
import { KIND_LABEL, type DiaperEntry } from './logic/types'
import { useDiaperStore } from './store'

/** Logging/editing diaper changes with an Undo toast, shared by the overview and history. */
export function useDiaperActions() {
  const store = useDiaperStore()

  async function logDiaper(input: NewDiaper) {
    const entry = await store.add(input)
    navigator.vibrate?.(30)
    toast(`${KIND_LABEL[entry.kind]} diaper logged`, {
      tone: 'ok',
      action: { label: 'Undo', run: () => void store.remove(entry.id) },
    })
    return entry
  }

  async function saveDiaper(entry: DiaperEntry) {
    const previous = store.diapers.find((e) => e.id === entry.id)
    const saved = await store.update(entry)
    toast('Diaper updated', {
      tone: 'ok',
      ...(previous ? { action: { label: 'Undo', run: () => void store.update(previous) } } : {}),
    })
    return saved
  }

  async function removeDiaper(id: string) {
    const removed = await store.remove(id)
    if (removed) toast('Diaper deleted', { action: { label: 'Undo', run: () => void store.restore(removed) } })
  }

  return { logDiaper, saveDiaper, removeDiaper }
}
