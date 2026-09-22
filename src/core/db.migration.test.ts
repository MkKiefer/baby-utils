import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { getDB } from './db'
import { DB_NAME, STORES } from './schema'

const T0 = Date.UTC(2026, 8, 22, 6, 0)
const MIN = 60_000

/**
 * Must be the only test file touching `getDB` here: the first call is what triggers the
 * upgrade from the v1 database this test seeds.
 */
describe('v1 to v2 upgrade', () => {
  it('backfills updatedAt on feeds written before merging existed', async () => {
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        for (const decl of STORES) {
          const store = db.createObjectStore(decl.name, decl.keyPath ? { keyPath: decl.keyPath } : undefined)
          for (const idx of decl.indexes ?? []) store.createIndex(idx.name, idx.keyPath)
        }
      },
    })
    const base = { source: 'app', plan: { baseMin: 150, offsetMin: 0 } }
    await v1.put('feeds', { ...base, id: 'has-created', at: T0, createdAt: T0 - MIN })
    await v1.put('feeds', { ...base, id: 'no-created', at: T0 })
    v1.close()

    const db = await getDB()
    expect((await db.get('feeds', 'has-created'))?.updatedAt).toBe(T0 - MIN)
    // Nothing better to go on than when the feed happened.
    expect((await db.get('feeds', 'no-created'))?.updatedAt).toBe(T0)
    expect((await db.get('feeds', 'has-created'))?.deletedAt).toBeUndefined()
  })
})
