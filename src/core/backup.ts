import { getDB, type DB } from './db'
import { DB_NAME, DB_VERSION, STORES, type StoreName } from './schema'
import { emitChange } from './sync'

/**
 * Whole-device backup. Generic over all declared stores, so new sub-apps are included
 * automatically. Only `bu.*` localStorage keys (UI preferences) are exported.
 */
export interface Backup {
  app: 'baby-utils'
  format: 1
  exportedAt: number
  db: { name: string; version: number }
  stores: Partial<Record<StoreName, { keyed: boolean; records: unknown[] }>>
  localStorage: Record<string, string>
}

const LS_PREFIX = 'bu.'

async function dumpStore(db: DB, name: StoreName) {
  const keyed = !STORES.find((s) => s.name === name)?.keyPath
  if (!keyed) return { keyed, records: await db.getAll(name) }
  const records: unknown[] = []
  let cursor = await db.transaction(name).store.openCursor()
  while (cursor) {
    records.push({ key: cursor.key, value: cursor.value })
    cursor = await cursor.continue()
  }
  return { keyed, records }
}

export async function createBackup(): Promise<Backup> {
  const db = await getDB()
  const backup: Backup = {
    app: 'baby-utils',
    format: 1,
    exportedAt: Date.now(),
    db: { name: DB_NAME, version: DB_VERSION },
    stores: {},
    localStorage: {},
  }
  for (const { name } of STORES) backup.stores[name] = await dumpStore(db, name)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(LS_PREFIX)) backup.localStorage[key] = localStorage.getItem(key) ?? ''
  }
  return backup
}

export function parseBackup(text: string): Backup {
  const data = JSON.parse(text) as Backup
  if (data?.app !== 'baby-utils' || data.format !== 1 || typeof data.stores !== 'object') {
    throw new Error('This file is not a Baby Utils backup.')
  }
  return data
}

/** Replaces all data with the backup's content. */
export async function restoreBackup(backup: Backup): Promise<void> {
  const db = await getDB()
  const names = STORES.map((s) => s.name)
  const tx = db.transaction(names, 'readwrite')
  for (const name of names) {
    const store = tx.objectStore(name)
    await store.clear()
    const dump = backup.stores[name]
    for (const record of dump?.records ?? []) {
      if (dump!.keyed) {
        const { key, value } = record as { key: string; value: unknown }
        await store.put(value as never, key as never)
      } else {
        await store.put(record as never)
      }
    }
  }
  await tx.done
  for (const [key, value] of Object.entries(backup.localStorage ?? {})) {
    if (key.startsWith(LS_PREFIX)) localStorage.setItem(key, value)
  }
  emitChange('all')
}

export async function wipeAllData(): Promise<void> {
  const db = await getDB()
  const names = STORES.map((s) => s.name)
  const tx = db.transaction(names, 'readwrite')
  await Promise.all(names.map((n) => tx.objectStore(n).clear()))
  await tx.done
  Object.keys(localStorage)
    .filter((k) => k.startsWith(LS_PREFIX))
    .forEach((k) => localStorage.removeItem(k))
  emitChange('all')
}

/** Uses the share sheet where files can be shared (mobile), otherwise downloads. */
export async function exportBackupFile(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const backup = await createBackup()
  const stamp = new Date(backup.exportedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const file = new File([JSON.stringify(backup, null, 2)], `baby-utils-${stamp}.json`, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Baby Utils backup' })
      return 'shared'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
