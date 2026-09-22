import { newId, plain, type DB } from '@/core/db'
import { ageDays } from '@/core/age'
import { readProfile } from '@/core/profile'
import { DAY } from '@/core/time'
import { computeFeedPlan, badgeFor, type FeedPlan } from './plan'
import { DEFAULT_FEED_SETTINGS, FEED_SETTINGS_KEY, type FeedEntry, type FeedSettings } from './types'
import type { NotificationProvider } from '@/core/notify/types'

/** IndexedDB access for the feed timer. DOM/Vue free: used by the service worker too. */

/** Enough history for rhythm learning (7 days) plus a margin. */
export const PLAN_HISTORY_MS = 8 * DAY

export async function readFeedSettings(db: DB): Promise<FeedSettings> {
  const stored = (await db.get('kv', FEED_SETTINGS_KEY)) as Partial<FeedSettings> | undefined
  return {
    ...DEFAULT_FEED_SETTINGS,
    ...stored,
    jaundice: { ...DEFAULT_FEED_SETTINGS.jaundice, ...stored?.jaundice },
    rhythm: { ...DEFAULT_FEED_SETTINGS.rhythm, ...stored?.rhythm },
  }
}

export async function writeFeedSettings(db: DB, settings: FeedSettings): Promise<void> {
  await db.put('kv', plain(settings), FEED_SETTINGS_KEY)
}

/** Drops tombstones: deleted entries stay in the store so merges can see the deletion. */
function live(entries: FeedEntry[]): FeedEntry[] {
  return entries.filter((e) => !e.deletedAt)
}

/** Feeds since `since` (ascending); always includes the latest feed even if older. */
export async function readFeedsSince(db: DB, since: number): Promise<FeedEntry[]> {
  const recent = live(await db.getAllFromIndex('feeds', 'byAt', IDBKeyRange.lowerBound(since)))
  if (recent.length) return recent
  let cursor = await db.transaction('feeds').store.index('byAt').openCursor(null, 'prev')
  while (cursor) {
    if (!cursor.value.deletedAt) return [cursor.value]
    cursor = await cursor.continue()
  }
  return []
}

export async function readAllFeeds(db: DB): Promise<FeedEntry[]> {
  return live(await db.getAllFromIndex('feeds', 'byAt'))
}

/** Every record, tombstones included: for merging, backup and the Debug app. */
export async function readFeedRecords(db: DB): Promise<FeedEntry[]> {
  return db.getAllFromIndex('feeds', 'byAt')
}

export async function loadPlan(db: DB, now: number): Promise<FeedPlan> {
  const [profile, settings, feeds] = await Promise.all([
    readProfile(db),
    readFeedSettings(db),
    readFeedsSince(db, now - PLAN_HISTORY_MS),
  ])
  return computeFeedPlan({
    feeds,
    settings,
    ageDays: profile ? ageDays(profile.birthDate, now) : null,
    now,
  })
}

export interface NewFeed {
  at: number
  kind?: FeedEntry['kind']
  note?: string
  source: FeedEntry['source']
}

/** Adds a feed and snapshots the interval that will apply after it. */
export async function addFeed(db: DB, input: NewFeed, now = Date.now()): Promise<FeedEntry> {
  const [profile, settings, feeds] = await Promise.all([
    readProfile(db),
    readFeedSettings(db),
    readFeedsSince(db, now - PLAN_HISTORY_MS),
  ])
  const entry: FeedEntry = {
    id: newId(),
    at: input.at,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    plan: { baseMin: 0, offsetMin: 0 },
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
  const plan = computeFeedPlan({
    feeds: [...feeds, entry],
    settings,
    ageDays: profile ? ageDays(profile.birthDate, input.at) : null,
    now,
  })
  entry.plan = { baseMin: plan.baseMin, offsetMin: plan.offsetMin }
  await db.put('feeds', plain(entry))
  return entry
}

export async function putFeed(db: DB, entry: FeedEntry, now = Date.now()): Promise<FeedEntry> {
  const next = plain({ ...entry, updatedAt: now })
  await db.put('feeds', next)
  return next
}

/**
 * Tombstones the entry instead of removing it. A hard delete would be undone by the next
 * merge, because the other device still has the entry and would look like the newer copy.
 */
export async function deleteFeed(db: DB, id: string, now = Date.now()): Promise<void> {
  const entry = await db.get('feeds', id)
  if (!entry) return
  await db.put('feeds', plain({ ...entry, deletedAt: now, updatedAt: now }))
}

/** Undo of `deleteFeed`: clears the tombstone and wins over it by being newer. */
export async function restoreFeed(db: DB, entry: FeedEntry, now = Date.now()): Promise<FeedEntry> {
  const { deletedAt: _deletedAt, ...rest } = entry
  const next = plain({ ...rest, updatedAt: now })
  await db.put('feeds', next)
  return next
}

export const feedNotificationProvider: NotificationProvider = {
  id: 'feed',
  async plan(db, now) {
    const plan = await loadPlan(db, now)
    return { notifications: plan.notifications, badge: badgeFor(plan) }
  },
}
