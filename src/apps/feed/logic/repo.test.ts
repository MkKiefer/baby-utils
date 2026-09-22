import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '@/core/db'
import { DB_NAME, DB_VERSION } from '@/core/schema'
import { mergeBackup } from '@/core/merge'
import type { Backup } from '@/core/backup'
import { addFeed, deleteFeed, readAllFeeds, readFeedRecords, readFeedsSince, restoreFeed } from './repo'
import type { FeedEntry } from './types'

const MIN = 60_000
const T0 = Date.UTC(2026, 8, 22, 6, 0)

/** A backup carrying just a feed log, as another device would export it. */
function backupOf(records: unknown[]): Backup {
  return {
    app: 'baby-utils',
    format: 1,
    exportedAt: T0,
    db: { name: DB_NAME, version: DB_VERSION },
    stores: { feeds: { keyed: false, records } },
    localStorage: {},
  }
}

const ids = (entries: FeedEntry[]) => entries.map((e) => e.id).sort()

describe('feed repo tombstones', () => {
  beforeEach(async () => {
    const db = await getDB()
    await Promise.all([db.clear('feeds'), db.clear('kv')])
  })

  it('hides deleted feeds from readers but keeps the record', async () => {
    const db = await getDB()
    const a = await addFeed(db, { at: T0, source: 'app' }, T0)
    await addFeed(db, { at: T0 + MIN, source: 'app' }, T0 + MIN)

    await deleteFeed(db, a.id, T0 + 2 * MIN)

    expect(await readAllFeeds(db)).toHaveLength(1)
    expect(await readFeedRecords(db)).toHaveLength(2)
    const record = (await readFeedRecords(db)).find((e) => e.id === a.id)
    expect(record?.deletedAt).toBe(T0 + 2 * MIN)
    expect(record?.updatedAt).toBe(T0 + 2 * MIN)
  })

  it('skips tombstones when falling back to the latest feed', async () => {
    const db = await getDB()
    const old = await addFeed(db, { at: T0, source: 'app' }, T0)
    const newer = await addFeed(db, { at: T0 + MIN, source: 'app' }, T0 + MIN)
    await deleteFeed(db, newer.id, T0 + 2 * MIN)

    // Nothing recent, so the fallback cursor must walk past the tombstone.
    const found = await readFeedsSince(db, T0 + 10 * MIN)
    expect(ids(found)).toEqual([old.id])
  })

  it('returns nothing when every feed is deleted', async () => {
    const db = await getDB()
    const only = await addFeed(db, { at: T0, source: 'app' }, T0)
    await deleteFeed(db, only.id, T0 + MIN)
    expect(await readFeedsSince(db, T0 + 10 * MIN)).toEqual([])
  })

  it('revives an entry on undo', async () => {
    const db = await getDB()
    const entry = await addFeed(db, { at: T0, source: 'app' }, T0)
    await deleteFeed(db, entry.id, T0 + MIN)
    await restoreFeed(db, entry, T0 + 2 * MIN)

    expect(ids(await readAllFeeds(db))).toEqual([entry.id])
    const record = (await readFeedRecords(db)).find((e) => e.id === entry.id)
    expect(record?.deletedAt).toBeUndefined()
  })
})

describe('mergeBackup', () => {
  beforeEach(async () => {
    const db = await getDB()
    await Promise.all([db.clear('feeds'), db.clear('kv')])
  })

  it('adds the other device’s feeds and applies its deletions', async () => {
    const db = await getDB()
    const mine = await addFeed(db, { at: T0, source: 'app' }, T0)

    const theirs = [
      { id: 'theirs-1', at: T0 + MIN, source: 'app', createdAt: T0 + MIN, updatedAt: T0 + MIN, plan: { baseMin: 150, offsetMin: 0 } },
      { ...mine, deletedAt: T0 + 5 * MIN, updatedAt: T0 + 5 * MIN },
    ]
    const stats = await mergeBackup(backupOf(theirs))

    expect(stats).toMatchObject({ added: 1, deleted: 1 })
    expect(ids(await readAllFeeds(db))).toEqual(['theirs-1'])
    expect(await readFeedRecords(db)).toHaveLength(2)
  })

  it('is a no-op the second time the same file is merged', async () => {
    const db = await getDB()
    await addFeed(db, { at: T0, source: 'app' }, T0)
    const theirs = [
      { id: 'theirs-1', at: T0 + MIN, source: 'app', createdAt: T0 + MIN, updatedAt: T0 + MIN, plan: { baseMin: 150, offsetMin: 0 } },
    ]

    expect((await mergeBackup(backupOf(theirs))).added).toBe(1)
    expect(await mergeBackup(backupOf(theirs))).toMatchObject({ added: 0, updated: 0, deleted: 0, unchanged: 1 })
    expect(await readAllFeeds(db)).toHaveLength(2)
  })

  it('leaves settings and profile alone', async () => {
    const db = await getDB()
    await db.put('kv', { name: 'Mine', birthDate: '2026-09-20', createdAt: T0 }, 'profile')
    const withProfile: Backup = {
      ...backupOf([]),
      stores: { ...backupOf([]).stores, kv: { keyed: true, records: [{ key: 'profile', value: { name: 'Theirs' } }] } },
    }

    await mergeBackup(withProfile)
    expect((await db.get('kv', 'profile')) as { name: string }).toMatchObject({ name: 'Mine' })
  })

  it('records what it did for the Debug app', async () => {
    const db = await getDB()
    await mergeBackup(backupOf([{ id: 'x', at: T0, createdAt: T0, updatedAt: T0, source: 'app', plan: { baseMin: 150, offsetMin: 0 } }]))
    expect((await db.get('kv', 'merge.last')) as { added: number; from: number }).toMatchObject({ added: 1, from: T0 })
  })
})
