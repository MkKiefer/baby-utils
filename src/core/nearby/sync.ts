import { getDB } from '../db'
import { DAY } from '../time'
import { mergeFeeds, readLastMerge, type MergeStats } from '../merge'
import { readFeedRecords } from '@/apps/feed/logic/repo'
import type { FeedEntry } from '@/apps/feed/logic/types'
import { newSession, packPayload, toFrames, unpackPayload } from './codec'

/**
 * Phone-to-phone sync over QR codes: build what to show, merge what was scanned.
 * Merging is the same union-by-id as a backup file, so a code can be scanned any number
 * of times and in either direction.
 */

/** "Recent" covers every change made in this window, on either phone. */
export const RECENT_WINDOW = 14 * DAY

export type NearbyScope = 'recent' | 'all'

export interface NearbyOffer {
  frames: string[]
  entries: number
  /** Length of the packed payload in characters. */
  chars: number
  since: number | null
}

/**
 * Entries changed after `since`. Tombstones are included (a delete bumps `updatedAt`), so
 * deletions travel too.
 */
export function selectForSync(records: FeedEntry[], since: number | null): FeedEntry[] {
  return since === null ? records : records.filter((e) => e.updatedAt > since)
}

export async function buildOffer(scope: NearbyScope, now = Date.now()): Promise<NearbyOffer> {
  const since = scope === 'all' ? null : now - RECENT_WINDOW
  const feeds = selectForSync(await readFeedRecords(await getDB()), since)
  const data = await packPayload({ v: 1, sentAt: now, since, feeds })
  return { frames: toFrames(data, newSession()), entries: feeds.length, chars: data.length, since }
}

export async function receiveOffer(data: string): Promise<MergeStats> {
  const payload = await unpackPayload(data)
  return mergeFeeds(payload.records, payload.sentAt, 'nearby')
}

/** A phone that never merged a nearby sync probably lacks the other's older history. */
export async function defaultScope(): Promise<NearbyScope> {
  const last = await readLastMerge()
  return last?.via === 'nearby' ? 'recent' : 'all'
}
