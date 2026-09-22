import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME, DB_VERSION, STORES, type BabyDB } from './schema'

export type DB = IDBPDatabase<BabyDB>

let dbPromise: Promise<DB> | null = null

export function getDB(): Promise<DB> {
  dbPromise ??= openDB<BabyDB>(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // Loosely typed on purpose: declarations drive the schema.
      const raw = db as unknown as IDBDatabase
      for (const decl of STORES) {
        const store = raw.objectStoreNames.contains(decl.name)
          ? (tx.objectStore(decl.name as never) as unknown as IDBObjectStore)
          : raw.createObjectStore(decl.name, decl.keyPath ? { keyPath: decl.keyPath } : undefined)
        for (const idx of decl.indexes ?? []) {
          if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath)
        }
      }
    },
    blocking() {
      // A newer version of the app wants to upgrade: let it.
      void dbPromise?.then((db) => db.close())
      dbPromise = null
    },
  })
  return dbPromise
}

/** Strip Vue proxies and undefined values so the object can be structured-cloned. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return (await db.get('kv', key)) as T | undefined
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await getDB()
  await db.put('kv', plain(value), key)
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDB()
  await db.delete('kv', key)
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
