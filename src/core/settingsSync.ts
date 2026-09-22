import { plain, type DB } from './db'
import { PROFILE_KEY } from './profile'
import { DEFAULT_FEED_SETTINGS, FEED_SETTINGS_KEY, withFeedDefaults } from '@/apps/feed/logic/types'
import { DEFAULT_WEIGHT_SETTINGS, WEIGHT_SETTINGS_KEY } from '@/apps/weight/logic/types'

/**
 * Settings that follow the baby rather than the phone — the profile and the sub-apps'
 * settings — travel with relay sync. DOM/Vue free: the service worker imports the feed repo, which
 * writes through here.
 *
 * Merging is per top-level field, last writer wins: every field carries the time it was
 * last changed on some device (its stamp), and the newer stamp wins, with the value itself
 * breaking exact ties so all devices pick the same winner. Two parents changing different
 * settings at once therefore both keep their change.
 *
 * Stamps live next to the documents in `kv` under `sync.stamps`, so a backup carries them.
 * A field without a stamp was set before this existed: it counts as 0 while it still has
 * its default and as 1 otherwise, so a phone's real choices beat another phone's defaults.
 * A phone that joins a group drops its stamps to 0 (`demoteSyncedDocs`), so it takes on the
 * group's settings instead of overwriting them with what it had set up alone.
 *
 * Fields listed as `local` are personal to the phone and never leave it.
 */

export interface DocSpec {
  /** Fields that stay on this device. */
  local?: string[]
  /** Values of never-set fields; a field that still has one counts as unset. */
  defaults?: Record<string, unknown>
  /** Fills in what an older stored document lacks. */
  normalize?: (stored: never) => object
  /** Whether a document assembled from synced fields is usable, for a device that had none. */
  valid?: (value: Record<string, unknown>) => boolean
}

export const SYNCED_DOCS: Record<string, DocSpec> = {
  [PROFILE_KEY]: {
    valid: (p) => typeof p.name === 'string' && typeof p.birthDate === 'string' && typeof p.createdAt === 'number',
  },
  [FEED_SETTINGS_KEY]: {
    // How insistently a phone reminds is up to the person holding it.
    local: ['maxUnconfirmed', 'notifyAtBase'],
    defaults: DEFAULT_FEED_SETTINGS as unknown as Record<string, unknown>,
    normalize: withFeedDefaults,
  },
  [WEIGHT_SETTINGS_KEY]: {
    defaults: DEFAULT_WEIGHT_SETTINGS as unknown as Record<string, unknown>,
    normalize: (stored: object) => ({ ...DEFAULT_WEIGHT_SETTINGS, ...stored }),
  },
}

export const STAMPS_KEY = 'sync.stamps'

/** One field as it travels: `value` is missing when the field was removed. */
export interface SyncedField {
  at: number
  value?: unknown
}

/** Document key → field → version. */
export type SyncedDocs = Record<string, Record<string, SyncedField>>
type Stamps = Record<string, Record<string, number>>

const json = (v: unknown) => JSON.stringify(v ?? null)
const same = (a: unknown, b: unknown) => json(a) === json(b)

function effective(spec: DocSpec, stored: unknown): Record<string, unknown> {
  if (!stored || typeof stored !== 'object') return {}
  return (spec.normalize ? spec.normalize(stored as never) : stored) as Record<string, unknown>
}

function syncedKeys(spec: DocSpec, ...sources: (object | undefined)[]): string[] {
  const keys = new Set(sources.flatMap((s) => Object.keys(s ?? {})))
  for (const f of spec.local ?? []) keys.delete(f)
  return [...keys]
}

function implicitStamp(spec: DocSpec, field: string, value: unknown): number {
  if (value === undefined) return 0
  return spec.defaults && same(value, spec.defaults[field]) ? 0 : 1
}

/** The synced fields of one stored document, with their versions. */
export function docFields(spec: DocSpec, stored: unknown, stamps: Record<string, number> = {}) {
  const value = effective(spec, stored)
  const fields: Record<string, SyncedField> = {}
  for (const f of syncedKeys(spec, value, stamps)) {
    const field: SyncedField = { at: stamps[f] ?? implicitStamp(spec, f, value[f]) }
    if (value[f] !== undefined) field.value = value[f]
    fields[f] = field
  }
  return fields
}

/** The version of a field that survives a merge. */
export function pickField(a: SyncedField, b: SyncedField): SyncedField {
  if (a.at !== b.at) return a.at > b.at ? a : b
  return json(a.value) >= json(b.value) ? a : b
}

function isField(value: unknown): value is SyncedField {
  const f = value as SyncedField
  return !!f && typeof f === 'object' && typeof f.at === 'number' && Number.isFinite(f.at)
}

/** Newest version of every field across several messages; drops anything malformed or local. */
export function foldDocs(list: unknown[]): SyncedDocs {
  const out: SyncedDocs = {}
  for (const docs of list) {
    if (!docs || typeof docs !== 'object') continue
    for (const [key, fields] of Object.entries(docs as Record<string, unknown>)) {
      const spec = SYNCED_DOCS[key]
      if (!spec || !fields || typeof fields !== 'object') continue
      const into = (out[key] ??= {})
      for (const f of syncedKeys(spec, fields)) {
        const field = (fields as Record<string, unknown>)[f]
        if (!isField(field)) continue
        into[f] = into[f] ? pickField(into[f], field) : field
      }
    }
  }
  return out
}

/** Pure core of the merge: the incoming fields that should replace this device's. */
export function mergeSyncedDocs(local: SyncedDocs, incoming: SyncedDocs): SyncedDocs {
  const changes: SyncedDocs = {}
  for (const [key, fields] of Object.entries(incoming)) {
    for (const [f, theirs] of Object.entries(fields)) {
      const mine = local[key]?.[f] ?? { at: 0 }
      const winner = pickField(theirs, mine)
      if (winner === mine || (winner.at === mine.at && same(winner.value, mine.value))) continue
      ;(changes[key] ??= {})[f] = winner
    }
  }
  return changes
}

export function countFields(docs: SyncedDocs): number {
  return Object.values(docs).reduce((n, fields) => n + Object.keys(fields).length, 0)
}

// ------------------------------------------------------------------------ IndexedDB

async function readStamps(db: DB): Promise<Stamps> {
  return ((await db.get('kv', STAMPS_KEY)) as Stamps | undefined) ?? {}
}

export async function readSyncedDocs(db: DB): Promise<SyncedDocs> {
  const stamps = await readStamps(db)
  const docs: SyncedDocs = {}
  for (const [key, spec] of Object.entries(SYNCED_DOCS)) {
    docs[key] = docFields(spec, await db.get('kv', key), stamps[key])
  }
  return docs
}

/** Saves a synced document, stamping the fields that differ from what was stored. */
export async function writeSyncedDoc(db: DB, key: string, next: object, now = Date.now()): Promise<void> {
  const spec = SYNCED_DOCS[key]!
  const tx = db.transaction('kv', 'readwrite')
  const before = effective(spec, await tx.store.get(key))
  const after = effective(spec, next)
  const stamps = ((await tx.store.get(STAMPS_KEY)) as Stamps | undefined) ?? {}
  const own = (stamps[key] ??= {})
  for (const f of syncedKeys(spec, before, after)) if (!same(before[f], after[f])) own[f] = now
  await tx.store.put(plain(next), key)
  await tx.store.put(stamps, STAMPS_KEY)
  await tx.done
}

/** Writes merged-in fields and their stamps. Returns how many fields changed. */
export async function applySyncedDocs(db: DB, changes: SyncedDocs): Promise<number> {
  let count = 0
  const tx = db.transaction('kv', 'readwrite')
  const stamps = ((await tx.store.get(STAMPS_KEY)) as Stamps | undefined) ?? {}
  for (const [key, fields] of Object.entries(changes)) {
    const spec = SYNCED_DOCS[key]
    const stored = (await tx.store.get(key)) as Record<string, unknown> | undefined
    if (!spec || !Object.keys(fields).length) continue
    const next = { ...stored }
    for (const [f, field] of Object.entries(fields)) {
      if ('value' in field) next[f] = field.value
      else delete next[f]
    }
    if (!stored && spec.valid && !spec.valid(next)) continue
    await tx.store.put(plain(next), key)
    const own = (stamps[key] ??= {})
    for (const [f, field] of Object.entries(fields)) own[f] = field.at
    count += Object.keys(fields).length
  }
  await tx.store.put(stamps, STAMPS_KEY)
  await tx.done
  return count
}

/** Makes every synced field lose against any version another phone has: used when joining. */
export async function demoteSyncedDocs(db: DB): Promise<void> {
  const docs = await readSyncedDocs(db)
  const stamps: Stamps = {}
  for (const [key, fields] of Object.entries(docs)) {
    stamps[key] = Object.fromEntries(Object.keys(fields).map((f) => [f, 0]))
  }
  await db.put('kv', stamps, STAMPS_KEY)
}
