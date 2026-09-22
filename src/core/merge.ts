import { getDB, plain } from './db'
import { emitChange } from './sync'
import { readFeedRecords } from '@/apps/feed/logic/repo'
import type { FeedEntry } from '@/apps/feed/logic/types'
import type { Backup } from './backup'

/**
 * Merging another device's backup into this one, for two phones that share a baby but
 * never share a server.
 *
 * The feed log is a set of entries with stable random ids, so merging is a union by id:
 * where only one device knows an id it is copied over, and where both do, the entry with
 * the newer `updatedAt` wins. Deletions travel as tombstones (`deletedAt`) — a hard
 * delete would simply be resurrected by the other device's copy on the next merge.
 *
 * The result is order-independent and idempotent: importing the same file twice, or each
 * device importing the other's file, converges on the same log.
 *
 * Only the `feeds` store is merged. Settings and the baby profile are single documents
 * with no sensible merge, so they stay device-local; `restoreBackup` still replaces a
 * whole device when that is what you want.
 *
 * Tombstones are kept forever. They are ~100 bytes each and only appear when a feed is
 * deleted, so pruning them would buy little and would risk resurrecting an entry that a
 * long-offline device still holds.
 */

export interface MergeStats {
  /** New entries that are now visible. */
  added: number
  /** Known entries replaced by a newer version from the other device. */
  updated: number
  /** Entries that were live here and the other device had deleted. */
  deleted: number
  /** Entries where this device already had the newer version. */
  unchanged: number
  /** Records that were not usable feed entries. */
  skipped: number
}

export interface LastMerge extends MergeStats {
  /** When the merge ran. */
  at: number
  /** `exportedAt` of the file that was merged in. */
  from: number
}

export const LAST_MERGE_KEY = 'merge.last'

function emptyStats(): MergeStats {
  return { added: 0, updated: 0, deleted: 0, unchanged: 0, skipped: 0 }
}

/** Total number of entries a merge actually wrote. */
export function changedCount(stats: MergeStats): number {
  return stats.added + stats.updated + stats.deleted
}

/**
 * Accepts anything that still looks like a feed and fills in what older backups lack,
 * so a file exported before the merge fields existed can still be merged.
 */
export function normalizeEntry(value: unknown): FeedEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<FeedEntry>
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : raw.at
  const entry: FeedEntry = {
    ...raw,
    id: raw.id,
    at: raw.at,
    source: raw.source ?? 'import',
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
    plan: raw.plan ?? { baseMin: 0, offsetMin: 0 },
  }
  if (typeof raw.deletedAt !== 'number') delete entry.deletedAt
  return entry
}

/**
 * Content key used to break `updatedAt` ties. Two devices comparing the same pair pick
 * the same winner, which is what keeps them convergent without a shared clock.
 */
function tieBreak(entry: FeedEntry): string {
  return JSON.stringify([entry.at, entry.deletedAt ?? 0, entry.kind ?? '', entry.note ?? '', entry.source])
}

/** The version of an entry that survives a merge. */
export function pickNewer(a: FeedEntry, b: FeedEntry): FeedEntry {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  return tieBreak(a) >= tieBreak(b) ? a : b
}

/** Two copies of an entry that would merge to the same thing, so writing is pointless. */
function sameContent(a: FeedEntry, b: FeedEntry): boolean {
  return a.updatedAt === b.updatedAt && tieBreak(a) === tieBreak(b)
}

export interface MergeOutcome {
  /** Entries to write locally; already the winning version. */
  writes: FeedEntry[]
  stats: MergeStats
}

/** Pure core of the merge: what `local` should take from `incoming`. */
export function mergeFeedRecords(local: FeedEntry[], incoming: unknown[]): MergeOutcome {
  const byId = new Map(local.map((e) => [e.id, e]))
  const writes: FeedEntry[] = []
  const stats = emptyStats()

  for (const raw of incoming) {
    const entry = normalizeEntry(raw)
    if (!entry) {
      stats.skipped++
      continue
    }
    const mine = byId.get(entry.id)
    if (!mine) {
      // A tombstone for an entry this device never had still gets stored, so the
      // deletion is not lost if the live version arrives from somewhere later.
      writes.push(entry)
      byId.set(entry.id, entry)
      if (entry.deletedAt) stats.unchanged++
      else stats.added++
      continue
    }
    const winner = pickNewer(entry, mine)
    // Identity alone is not enough: re-merging the same file yields equal-but-distinct
    // objects, and rewriting those would make the merge non-idempotent.
    if (winner === mine || sameContent(winner, mine)) {
      stats.unchanged++
      continue
    }
    writes.push(winner)
    // Guard against a malformed file carrying the same id twice.
    byId.set(entry.id, winner)
    if (!mine.deletedAt && winner.deletedAt) stats.deleted++
    else stats.updated++
  }

  return { writes, stats }
}

/** Reads the feed records out of a backup, tolerating either dump shape. */
function incomingFeeds(backup: Backup): unknown[] {
  const dump = backup.stores.feeds
  if (!dump) return []
  return dump.keyed ? dump.records.map((r) => (r as { value: unknown }).value) : dump.records
}

/** Merges a backup's feed log into this device. Leaves settings and profile untouched. */
export async function mergeBackup(backup: Backup): Promise<MergeStats> {
  const db = await getDB()
  const { writes, stats } = mergeFeedRecords(await readFeedRecords(db), incomingFeeds(backup))

  if (writes.length) {
    const tx = db.transaction('feeds', 'readwrite')
    for (const entry of writes) await tx.store.put(plain(entry))
    await tx.done
  }

  const last: LastMerge = { ...stats, at: Date.now(), from: backup.exportedAt }
  await db.put('kv', plain(last), LAST_MERGE_KEY)
  // 'all' rather than 'feeds': the feed store only reloads on a foreign or global change.
  emitChange('all')
  return stats
}

export async function readLastMerge(): Promise<LastMerge | null> {
  const db = await getDB()
  return ((await db.get('kv', LAST_MERGE_KEY)) as LastMerge | undefined) ?? null
}

/** One-line summary for a toast. */
export function describeMerge(stats: MergeStats): string {
  if (!changedCount(stats)) return 'Already up to date'
  const parts: string[] = []
  if (stats.added) parts.push(`${stats.added} new`)
  if (stats.updated) parts.push(`${stats.updated} updated`)
  if (stats.deleted) parts.push(`${stats.deleted} deleted`)
  return `Merged: ${parts.join(', ')}`
}
