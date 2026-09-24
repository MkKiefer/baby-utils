import { newId, plain, type DB } from '@/core/db'
import { isDirty, type DiaperEntry, type DiaperKind, type StoolColor } from './types'

/** IndexedDB access for the diaper log. DOM/Vue free, like the feed repo. */

/** Live entries, oldest first. Tombstones stay in the store for merging. */
export async function readAllDiapers(db: DB): Promise<DiaperEntry[]> {
  return (await db.getAllFromIndex('diapers', 'byAt')).filter((e) => !e.deletedAt)
}

/** Every record, tombstones included: for merging, sync and the Debug app. */
export async function readDiaperRecords(db: DB): Promise<DiaperEntry[]> {
  return db.getAllFromIndex('diapers', 'byAt')
}

export interface NewDiaper {
  at: number
  kind: DiaperKind
  stool?: StoolColor
  note?: string
}

/** A stool colour only belongs to a diaper that was dirty. */
function cleaned<T extends { kind: DiaperKind; stool?: StoolColor }>(entry: T): T {
  if (isDirty(entry) || !entry.stool) return entry
  const { stool: _stool, ...rest } = entry
  return rest as T
}

export async function addDiaper(db: DB, input: NewDiaper, now = Date.now()): Promise<DiaperEntry> {
  const entry: DiaperEntry = cleaned({
    id: newId(),
    at: input.at,
    kind: input.kind,
    source: 'app',
    createdAt: now,
    updatedAt: now,
    ...(input.stool ? { stool: input.stool } : {}),
    ...(input.note ? { note: input.note } : {}),
  })
  await db.put('diapers', plain(entry))
  return entry
}

export async function putDiaper(db: DB, entry: DiaperEntry, now = Date.now()): Promise<DiaperEntry> {
  const next = plain(cleaned({ ...entry, updatedAt: now }))
  await db.put('diapers', next)
  return next
}

/** Tombstones the entry, so the deletion survives a merge (see `deleteFeed`). */
export async function deleteDiaper(db: DB, id: string, now = Date.now()): Promise<void> {
  const entry = await db.get('diapers', id)
  if (!entry) return
  await db.put('diapers', plain({ ...entry, deletedAt: now, updatedAt: now }))
}

/** Undo of `deleteDiaper`. */
export async function restoreDiaper(db: DB, entry: DiaperEntry, now = Date.now()): Promise<DiaperEntry> {
  const { deletedAt: _deletedAt, ...rest } = entry
  const next = plain({ ...rest, updatedAt: now })
  await db.put('diapers', next)
  return next
}
