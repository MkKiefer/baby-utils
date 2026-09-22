import { newId, plain, type DB } from '@/core/db'
import { writeSyncedDoc } from '@/core/settingsSync'
import { parseLocalDate } from '@/core/age'
import type { Profile } from '@/core/profile'
import { DEFAULT_WEIGHT_SETTINGS, WEIGHT_SETTINGS_KEY, type WeightEntry, type WeightSettings } from './types'

/** IndexedDB access for the weight tracker. DOM/Vue free, like the feed repo. */

export async function readWeightSettings(db: DB): Promise<WeightSettings> {
  const stored = (await db.get('kv', WEIGHT_SETTINGS_KEY)) as Partial<WeightSettings> | undefined
  return { ...DEFAULT_WEIGHT_SETTINGS, ...stored }
}

/** Stamps what changed, so the change reaches the other phones of a sync group. */
export function writeWeightSettings(db: DB, settings: WeightSettings): Promise<void> {
  return writeSyncedDoc(db, WEIGHT_SETTINGS_KEY, settings)
}

/** Live entries, oldest first. Tombstones stay in the store for merging. */
export async function readAllWeights(db: DB): Promise<WeightEntry[]> {
  return (await db.getAllFromIndex('weights', 'byAt')).filter((e) => !e.deletedAt)
}

/** Every record, tombstones included: for merging, sync and the Debug app. */
export async function readWeightRecords(db: DB): Promise<WeightEntry[]> {
  return db.getAllFromIndex('weights', 'byAt')
}

export interface NewWeight {
  at: number
  grams: number
  note?: string
}

export async function addWeight(db: DB, input: NewWeight, now = Date.now()): Promise<WeightEntry> {
  const entry: WeightEntry = {
    id: newId(),
    at: input.at,
    grams: Math.round(input.grams),
    source: 'app',
    createdAt: now,
    updatedAt: now,
    ...(input.note ? { note: input.note } : {}),
  }
  await db.put('weights', plain(entry))
  return entry
}

export async function putWeight(db: DB, entry: WeightEntry, now = Date.now()): Promise<WeightEntry> {
  const next = plain({ ...entry, grams: Math.round(entry.grams), updatedAt: now })
  await db.put('weights', next)
  return next
}

/** Tombstones the entry, so the deletion survives a merge (see `deleteFeed`). */
export async function deleteWeight(db: DB, id: string, now = Date.now()): Promise<void> {
  const entry = await db.get('weights', id)
  if (!entry) return
  await db.put('weights', plain({ ...entry, deletedAt: now, updatedAt: now }))
}

/** Undo of `deleteWeight`. */
export async function restoreWeight(db: DB, entry: WeightEntry, now = Date.now()): Promise<WeightEntry> {
  const { deletedAt: _deletedAt, ...rest } = entry
  const next = plain({ ...rest, updatedAt: now })
  await db.put('weights', next)
  return next
}

/** Moment of birth (local), using the birth time when the profile has one. */
export function birthMoment(profile: Pick<Profile, 'birthDate' | 'birthTime'> | null): number | null {
  if (!profile?.birthDate) return null
  const d = parseLocalDate(profile.birthDate)
  const [h, m] = (profile.birthTime ?? '12:00').split(':').map(Number)
  d.setHours(h ?? 12, m ?? 0, 0, 0)
  return d.getTime()
}
