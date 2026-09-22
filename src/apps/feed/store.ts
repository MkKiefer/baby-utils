import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getDB } from '@/core/db'
import { ageDays } from '@/core/age'
import { emitChange, onChange } from '@/core/sync'
import { DAY } from '@/core/time'
import { useNow } from '@/composables/useNow'
import { useProfileStore } from '@/stores/profile'
import { computeFeedPlan, sortFeeds } from './logic/plan'
import {
  addFeed,
  deleteFeed,
  putFeed,
  readAllFeeds,
  readFeedSettings,
  restoreFeed,
  writeFeedSettings,
  PLAN_HISTORY_MS,
} from './logic/repo'
import { DEFAULT_FEED_SETTINGS, type FeedEntry, type FeedKind, type FeedSettings } from './logic/types'

export const useFeedStore = defineStore('feed', () => {
  const feeds = ref<FeedEntry[]>([])
  const settings = ref<FeedSettings>(structuredClone(DEFAULT_FEED_SETTINGS))
  const loaded = ref(false)
  const now = useNow()
  const profileStore = useProfileStore()

  const babyAgeDays = computed(() =>
    profileStore.profile ? ageDays(profileStore.profile.birthDate, now.value) : null,
  )

  /** The plan only needs the last days of history; keeps the per-second recompute cheap. */
  const planFeeds = computed(() => {
    const cutoff = Date.now() - PLAN_HISTORY_MS
    const recent = feeds.value.filter((f) => f.at >= cutoff)
    return recent.length ? recent : feeds.value.slice(-1)
  })

  const plan = computed(() =>
    computeFeedPlan({ feeds: planFeeds.value, settings: settings.value, ageDays: babyAgeDays.value, now: now.value }),
  )

  const last24h = computed(() => feeds.value.filter((f) => f.at > now.value - DAY))

  /** Suggest the other breast after a breastfeed. */
  const suggestedKind = computed<FeedKind | null>(() => {
    const lastBreast = [...feeds.value].reverse().find((f) => f.kind === 'left' || f.kind === 'right')
    if (!lastBreast) return null
    return lastBreast.kind === 'left' ? 'right' : 'left'
  })

  let loading: Promise<void> | null = null

  async function load() {
    const db = await getDB()
    const [all, s] = await Promise.all([readAllFeeds(db), readFeedSettings(db)])
    feeds.value = all
    settings.value = s
    loaded.value = true
  }

  function ensureLoaded() {
    loading ??= load()
    return loading
  }

  async function log(input: { at: number; kind?: FeedKind; note?: string }) {
    const entry = await addFeed(await getDB(), { ...input, source: 'app' })
    feeds.value = sortFeeds([...feeds.value, entry])
    emitChange('feeds')
    return entry
  }

  async function update(entry: FeedEntry) {
    const saved = await putFeed(await getDB(), entry)
    feeds.value = sortFeeds(feeds.value.map((f) => (f.id === saved.id ? saved : f)))
    emitChange('feeds')
  }

  async function remove(id: string) {
    const entry = feeds.value.find((f) => f.id === id)
    await deleteFeed(await getDB(), id)
    feeds.value = feeds.value.filter((f) => f.id !== id)
    emitChange('feeds')
    return entry
  }

  /** Puts a deleted entry back (undo), clearing the tombstone `remove` left behind. */
  async function restore(entry: FeedEntry) {
    const saved = await restoreFeed(await getDB(), entry)
    feeds.value = sortFeeds([...feeds.value.filter((f) => f.id !== saved.id), saved])
    emitChange('feeds')
  }

  async function saveSettings(patch: Partial<FeedSettings>) {
    settings.value = { ...settings.value, ...patch }
    await writeFeedSettings(await getDB(), settings.value)
    emitChange('feed.settings')
  }

  onChange((e) => {
    if (e.scope === 'all' || (!e.local && (e.scope === 'feeds' || e.scope === 'feed.settings'))) {
      loading = load()
    }
  })

  return {
    feeds,
    settings,
    loaded,
    plan,
    babyAgeDays,
    last24h,
    suggestedKind,
    ensureLoaded,
    log,
    update,
    remove,
    restore,
    saveSettings,
  }
})
