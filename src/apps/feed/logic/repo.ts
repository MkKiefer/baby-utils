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

/** Feeds since `since` (ascending); always includes the latest feed even if older. */
export async function readFeedsSince(db: DB, since: number): Promise<FeedEntry[]> {
  const recent = await db.getAllFromIndex('feeds', 'byAt', IDBKeyRange.lowerBound(since))
  if (recent.length) return recent
  const cursor = await db.transaction('feeds').store.index('byAt').openCursor(null, 'prev')
  return cursor ? [cursor.value] : []
}

export async function readAllFeeds(db: DB): Promise<FeedEntry[]> {
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

export async function putFeed(db: DB, entry: FeedEntry): Promise<void> {
  await db.put('feeds', plain(entry))
}

export async function deleteFeed(db: DB, id: string): Promise<void> {
  await db.delete('feeds', id)
}

export const feedNotificationProvider: NotificationProvider = {
  id: 'feed',
  async plan(db, now) {
    const plan = await loadPlan(db, now)
    return { notifications: plan.notifications, badge: badgeFor(plan) }
  },
}
