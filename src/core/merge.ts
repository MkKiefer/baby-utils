import { getDB, plain } from './db'
import { emitChange } from './sync'
import { readFeedRecords } from '@/apps/feed/logic/repo'
import type { FeedEntry } from '@/apps/feed/logic/types'
import { readWeightRecords } from '@/apps/weight/logic/repo'
import type { WeightEntry } from '@/apps/weight/logic/types'
import { readDiaperRecords } from '@/apps/diaper/logic/repo'
import { DIAPER_KINDS, type DiaperEntry } from '@/apps/diaper/logic/types'
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
 * The same rules apply to every synced log — `feeds`, `weights` and `diapers` — through one generic
 * core. Settings and the baby profile travel with relay sync instead, merged per field
 * (`settingsSync.ts`); a backup file merge leaves them alone, and `restoreBackup` still
 * replaces a whole device when that is what you want.
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
  /** Records that were not usable entries. */
  skipped: number
}

export interface LastMerge extends MergeStats {
  /** When the merge ran. */
  at: number
  /** `exportedAt` of the file (or the newest `sentAt` of a relay sync) that was merged in. */
  from: number
  /** How the other device's data arrived; missing on old merges, 'nearby' was the retired QR sync. */
  via?: 'file' | 'nearby' | 'cloud'
}

export const LAST_MERGE_KEY = 'merge.last'

function emptyStats(): MergeStats {
  return { added: 0, updated: 0, deleted: 0, unchanged: 0, skipped: 0 }
}

function addStats(a: MergeStats, b: MergeStats): MergeStats {
  return {
    added: a.added + b.added,
    updated: a.updated + b.updated,
    deleted: a.deleted + b.deleted,
    unchanged: a.unchanged + b.unchanged,
    skipped: a.skipped + b.skipped,
  }
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

/** What every synced log entry carries. */
interface Syncable {
  id: string
  updatedAt: number
  deletedAt?: number
}

/** How to read and compare one kind of synced entry. */
interface MergeKind<T extends Syncable> {
  normalize(value: unknown): T | null
  /**
   * Content key used to break `updatedAt` ties. Two devices comparing the same pair pick
   * the same winner, which is what keeps them convergent without a shared clock.
   */
  tieBreak(entry: T): string
}

const feedKind: MergeKind<FeedEntry> = {
  normalize: normalizeEntry,
  tieBreak: (e) => JSON.stringify([e.at, e.deletedAt ?? 0, e.kind ?? '', e.note ?? '', e.source]),
}

/** Like `normalizeEntry`, for weighings. */
export function normalizeWeight(value: unknown): WeightEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<WeightEntry>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null
  if (typeof raw.grams !== 'number' || !Number.isFinite(raw.grams) || raw.grams <= 0) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : raw.at
  const entry: WeightEntry = {
    ...raw,
    id: raw.id,
    at: raw.at,
    grams: raw.grams,
    source: raw.source ?? 'import',
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
  }
  if (typeof raw.deletedAt !== 'number') delete entry.deletedAt
  return entry
}

const weightKind: MergeKind<WeightEntry> = {
  normalize: normalizeWeight,
  tieBreak: (e) => JSON.stringify([e.at, e.deletedAt ?? 0, e.grams, e.note ?? '', e.source]),
}

/** Like `normalizeEntry`, for diaper changes. */
export function normalizeDiaper(value: unknown): DiaperEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<DiaperEntry>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null
  if (!raw.kind || !DIAPER_KINDS.includes(raw.kind)) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : raw.at
  const entry: DiaperEntry = {
    ...raw,
    id: raw.id,
    at: raw.at,
    kind: raw.kind,
    source: raw.source ?? 'import',
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
  }
  if (typeof raw.deletedAt !== 'number') delete entry.deletedAt
  return entry
}

const diaperKind: MergeKind<DiaperEntry> = {
  normalize: normalizeDiaper,
  tieBreak: (e) => JSON.stringify([e.at, e.deletedAt ?? 0, e.kind, e.stool ?? '', e.note ?? '', e.source]),
}

function newer<T extends Syncable>(kind: MergeKind<T>, a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  return kind.tieBreak(a) >= kind.tieBreak(b) ? a : b
}

/** The version of a feed that survives a merge. */
export function pickNewer(a: FeedEntry, b: FeedEntry): FeedEntry {
  return newer(feedKind, a, b)
}

export interface MergeOutcome<T = FeedEntry> {
  /** Entries to write locally; already the winning version. */
  writes: T[]
  stats: MergeStats
}

/** Pure core of the merge: what `local` should take from `incoming`. */
function mergeRecords<T extends Syncable>(kind: MergeKind<T>, local: T[], incoming: unknown[]): MergeOutcome<T> {
  const byId = new Map(local.map((e) => [e.id, e]))
  const writes: T[] = []
  const stats = emptyStats()
  // Two copies of an entry that would merge to the same thing, so writing is pointless.
  const sameContent = (a: T, b: T) => a.updatedAt === b.updatedAt && kind.tieBreak(a) === kind.tieBreak(b)

  for (const raw of incoming) {
    const entry = kind.normalize(raw)
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
    const winner = newer(kind, entry, mine)
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

export function mergeFeedRecords(local: FeedEntry[], incoming: unknown[]): MergeOutcome<FeedEntry> {
  return mergeRecords(feedKind, local, incoming)
}

export function mergeWeightRecords(local: WeightEntry[], incoming: unknown[]): MergeOutcome<WeightEntry> {
  return mergeRecords(weightKind, local, incoming)
}

export function mergeDiaperRecords(local: DiaperEntry[], incoming: unknown[]): MergeOutcome<DiaperEntry> {
  return mergeRecords(diaperKind, local, incoming)
}

/** Records from another device, per synced store. Unknown shapes are skipped, not trusted. */
export interface IncomingRecords {
  feeds: unknown[]
  weights: unknown[]
  /** Missing from app versions before the diaper log. */
  diapers?: unknown[]
}

/** Reads one store's records out of a backup, tolerating either dump shape. */
function fromBackup(backup: Backup, name: 'feeds' | 'weights' | 'diapers'): unknown[] {
  const dump = backup.stores[name]
  if (!dump) return []
  return dump.keyed ? dump.records.map((r) => (r as { value: unknown }).value) : dump.records
}

/** Merges a backup's feeds, weighings and diapers into this device. Leaves settings and profile untouched. */
export function mergeBackup(backup: Backup): Promise<MergeStats> {
  return mergeIncoming(
    { feeds: fromBackup(backup, 'feeds'), weights: fromBackup(backup, 'weights'), diapers: fromBackup(backup, 'diapers') },
    backup.exportedAt,
    'file',
  )
}

/** Merges records from another device, however they arrived. Stats cover all stores. */
export async function mergeIncoming(incoming: IncomingRecords, from: number, via: LastMerge['via']): Promise<MergeStats> {
  const db = await getDB()
  const [localFeeds, localWeights, localDiapers] = await Promise.all([
    readFeedRecords(db),
    readWeightRecords(db),
    readDiaperRecords(db),
  ])
  const feeds = mergeFeedRecords(localFeeds, incoming.feeds)
  const weights = mergeWeightRecords(localWeights, incoming.weights)
  const diapers = mergeDiaperRecords(localDiapers, incoming.diapers ?? [])

  if (feeds.writes.length || weights.writes.length || diapers.writes.length) {
    const tx = db.transaction(['feeds', 'weights', 'diapers'], 'readwrite')
    for (const entry of feeds.writes) await tx.objectStore('feeds').put(plain(entry))
    for (const entry of weights.writes) await tx.objectStore('weights').put(plain(entry))
    for (const entry of diapers.writes) await tx.objectStore('diapers').put(plain(entry))
    await tx.done
  }

  const stats = addStats(addStats(feeds.stats, weights.stats), diapers.stats)
  const last: LastMerge = { ...stats, at: Date.now(), from, via }
  await db.put('kv', plain(last), LAST_MERGE_KEY)
  // 'all' rather than a store scope: stores only reload on a foreign or global change.
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
