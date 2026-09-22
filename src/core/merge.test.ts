import { describe, expect, it } from 'vitest'
import { describeMerge, mergeFeedRecords, normalizeEntry, pickNewer } from './merge'
import type { FeedEntry } from '@/apps/feed/logic/types'

const T0 = new Date(2026, 8, 22, 8, 0).getTime()
const MIN = 60_000

function feed(id: string, patch: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id,
    at: T0,
    source: 'app',
    createdAt: T0,
    updatedAt: T0,
    plan: { baseMin: 150, offsetMin: 0 },
    ...patch,
  }
}

/** Applies a merge result the way `mergeBackup` writes it to the store. */
function apply(local: FeedEntry[], incoming: unknown[]): FeedEntry[] {
  const { writes } = mergeFeedRecords(local, incoming)
  const byId = new Map(local.map((e) => [e.id, e]))
  for (const w of writes) byId.set(w.id, w)
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

const liveIds = (entries: FeedEntry[]) => entries.filter((e) => !e.deletedAt).map((e) => e.id)

describe('normalizeEntry', () => {
  it('rejects records that are not feeds', () => {
    expect(normalizeEntry(null)).toBeNull()
    expect(normalizeEntry({ at: T0 })).toBeNull()
    expect(normalizeEntry({ id: 'a' })).toBeNull()
    expect(normalizeEntry({ id: 'a', at: Number.NaN })).toBeNull()
  })

  it('backfills updatedAt for entries exported before merge existed', () => {
    const legacy = { id: 'a', at: T0, source: 'app', createdAt: T0 - MIN, plan: { baseMin: 150, offsetMin: 0 } }
    expect(normalizeEntry(legacy)?.updatedAt).toBe(T0 - MIN)
  })

  it('falls back to `at` when createdAt is missing too', () => {
    expect(normalizeEntry({ id: 'a', at: T0 })?.updatedAt).toBe(T0)
  })
})

describe('pickNewer', () => {
  it('keeps the later edit', () => {
    const older = feed('a', { note: 'old' })
    const newer = feed('a', { note: 'new', updatedAt: T0 + MIN })
    expect(pickNewer(older, newer)).toBe(newer)
    expect(pickNewer(newer, older)).toBe(newer)
  })

  it('breaks updatedAt ties the same way from either side', () => {
    const a = feed('x', { note: 'aaa' })
    const b = feed('x', { note: 'bbb' })
    expect(pickNewer(a, b)).toBe(pickNewer(b, a))
  })
})

describe('mergeFeedRecords', () => {
  it('unions entries only one device knows', () => {
    const mine = [feed('a')]
    const theirs = [feed('b', { at: T0 + MIN })]
    const { stats } = mergeFeedRecords(mine, theirs)
    expect(stats.added).toBe(1)
    expect(liveIds(apply(mine, theirs))).toEqual(['a', 'b'])
  })

  it('takes the other device’s newer edit but not its older one', () => {
    const mine = [feed('a', { note: 'mine', updatedAt: T0 + 2 * MIN })]
    const stale = [feed('a', { note: 'stale', updatedAt: T0 })]
    expect(mergeFeedRecords(mine, stale).stats).toMatchObject({ updated: 0, unchanged: 1 })

    const fresh = [feed('a', { note: 'theirs', updatedAt: T0 + 5 * MIN })]
    const merged = apply(mine, fresh)
    expect(mergeFeedRecords(mine, fresh).stats).toMatchObject({ updated: 1 })
    expect(merged[0].note).toBe('theirs')
  })

  it('applies a deletion made on the other device', () => {
    const mine = [feed('a'), feed('b', { at: T0 + MIN })]
    const theirs = [feed('a', { deletedAt: T0 + MIN, updatedAt: T0 + MIN })]
    const { stats } = mergeFeedRecords(mine, theirs)
    expect(stats.deleted).toBe(1)
    expect(liveIds(apply(mine, theirs))).toEqual(['b'])
  })

  it('does not resurrect a deleted entry when the other device still has it live', () => {
    const deleted = feed('a', { deletedAt: T0 + MIN, updatedAt: T0 + MIN })
    const theirStaleCopy = [feed('a')]
    expect(liveIds(apply([deleted], theirStaleCopy))).toEqual([])
  })

  it('lets a later re-add win over an earlier deletion', () => {
    const deleted = [feed('a', { deletedAt: T0 + MIN, updatedAt: T0 + MIN })]
    const readded = [feed('a', { updatedAt: T0 + 2 * MIN })]
    expect(liveIds(apply(deleted, readded))).toEqual(['a'])
  })

  it('keeps a tombstone for an entry this device never saw', () => {
    const theirs = [feed('z', { deletedAt: T0, updatedAt: T0 })]
    const merged = apply([], theirs)
    expect(merged).toHaveLength(1)
    expect(liveIds(merged)).toEqual([])
  })

  it('is idempotent: merging the same file twice changes nothing the second time', () => {
    const mine = [feed('a')]
    const theirs = [feed('b', { at: T0 + MIN }), feed('a', { note: 'edited', updatedAt: T0 + MIN })]
    const once = apply(mine, theirs)
    expect(mergeFeedRecords(once, theirs).writes).toHaveLength(0)
    expect(apply(once, theirs)).toEqual(once)
  })

  it('converges: each device merging the other ends up with the same log', () => {
    const shared = feed('s')
    const deviceA = [shared, feed('a1', { at: T0 + MIN }), feed('a2', { at: T0 + 2 * MIN, deletedAt: T0 + 3 * MIN, updatedAt: T0 + 3 * MIN })]
    const deviceB = [feed('s', { note: 'B edited', updatedAt: T0 + 9 * MIN }), feed('b1', { at: T0 + 4 * MIN })]

    expect(apply(deviceA, deviceB)).toEqual(apply(deviceB, deviceA))
    expect(liveIds(apply(deviceA, deviceB))).toEqual(['a1', 'b1', 's'])
    expect(apply(deviceA, deviceB).find((e) => e.id === 's')?.note).toBe('B edited')
  })

  it('counts unusable records instead of throwing', () => {
    const { stats } = mergeFeedRecords([], [null, { nope: true }, feed('a')])
    expect(stats).toMatchObject({ skipped: 2, added: 1 })
  })
})

describe('describeMerge', () => {
  it('reports no-op merges', () => {
    expect(describeMerge({ added: 0, updated: 0, deleted: 0, unchanged: 4, skipped: 0 })).toBe('Already up to date')
  })

  it('lists what changed', () => {
    expect(describeMerge({ added: 2, updated: 1, deleted: 1, unchanged: 0, skipped: 0 })).toBe(
      'Merged: 2 new, 1 updated, 1 deleted',
    )
  })
})
