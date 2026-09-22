import { toast } from '@/composables/useToast'
import { formatWeight } from './logic/format'
import type { NewWeight } from './logic/repo'
import type { WeightEntry } from './logic/types'
import { useWeightStore } from './store'

/** Adding/editing weighings with an Undo toast, shared by the overview and history. */
export function useWeightActions() {
  const store = useWeightStore()

  async function addWeighing(input: NewWeight) {
    const entry = await store.add(input)
    navigator.vibrate?.(30)
    toast(`Weight logged · ${formatWeight(entry.grams, store.unit)}`, {
      tone: 'ok',
      action: { label: 'Undo', run: () => void store.remove(entry.id) },
    })
    return entry
  }

  async function saveWeighing(entry: WeightEntry) {
    const previous = store.weights.find((e) => e.id === entry.id)
    await store.update(entry)
    toast(`Weight updated · ${formatWeight(entry.grams, store.unit)}`, {
      tone: 'ok',
      ...(previous ? { action: { label: 'Undo', run: () => void store.update(previous) } } : {}),
    })
  }

  async function removeWeighing(id: string) {
    const removed = await store.remove(id)
    if (removed) toast('Weighing deleted', { action: { label: 'Undo', run: () => void store.restore(removed) } })
  }

  return { addWeighing, saveWeighing, removeWeighing }
}
