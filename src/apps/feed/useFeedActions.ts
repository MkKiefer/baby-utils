import { toast } from '@/composables/useToast'
import { formatClock } from '@/core/time'
import { useFeedStore } from './store'
import type { FeedEntry, FeedKind } from './logic/types'
import { KIND_LABEL } from './logic/types'

/** Logging/editing with an Undo toast, shared by the timer, night and history views. */
export function useFeedActions() {
  const store = useFeedStore()

  async function logFeed(at = Date.now(), kind?: FeedKind, note?: string) {
    const entry = await store.log({ at, kind, note })
    navigator.vibrate?.(30)
    const what = kind ? ` · ${KIND_LABEL[kind]}` : ''
    toast(`Feed logged at ${formatClock(entry.at)}${what}`, {
      tone: 'ok',
      action: { label: 'Undo', run: () => void store.remove(entry.id) },
    })
    return entry
  }

  async function removeFeed(id: string) {
    const removed = await store.remove(id)
    if (removed) {
      toast('Feed deleted', { action: { label: 'Undo', run: () => void store.restore(removed) } })
    }
  }

  async function saveFeed(entry: FeedEntry) {
    const previous = store.feeds.find((f) => f.id === entry.id)
    await store.update(entry)
    toast(`Feed updated · ${formatClock(entry.at)}`, {
      tone: 'ok',
      ...(previous ? { action: { label: 'Undo', run: () => void store.update(previous) } } : {}),
    })
  }

  return { logFeed, removeFeed, saveFeed }
}
