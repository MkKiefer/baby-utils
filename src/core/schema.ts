import type { DBSchema } from 'idb'
import type { NotifLogEntry } from './notify/types'
import type { FeedEntry } from '@/apps/feed/logic/types'
import type { WeightEntry } from '@/apps/weight/logic/types'

/**
 * Single IndexedDB database shared by the shell and every sub-app.
 *
 * Adding a store: extend `BabyDB`, add a declaration to `STORES` and bump `DB_VERSION`.
 * The upgrade handler creates whatever is missing, so declarations are idempotent.
 * This file must stay free of DOM/Vue imports: the service worker uses it too.
 */
export interface BabyDB extends DBSchema {
  /** Out-of-line keys: settings and profile documents, e.g. `profile`, `feed.settings`. */
  kv: { key: string; value: unknown }
  notifLog: { key: string; value: NotifLogEntry; indexes: { byFiredAt: number } }
  feeds: { key: string; value: FeedEntry; indexes: { byAt: number } }
  weights: { key: string; value: WeightEntry; indexes: { byAt: number } }
}

export type StoreName = 'kv' | 'notifLog' | 'feeds' | 'weights'

export interface StoreDecl {
  name: StoreName
  keyPath?: string
  indexes?: { name: string; keyPath: string }[]
  /** Which part of the app owns the store (shown in Debug). */
  owner: string
}

export const DB_NAME = 'baby-utils'

/**
 * v2: `feeds` entries gained `updatedAt`/`deletedAt` so two devices can be merged.
 * v3: `weights` store for the weight tracker.
 */
export const DB_VERSION = 3

export const STORES: StoreDecl[] = [
  { name: 'kv', owner: 'core' },
  { name: 'notifLog', keyPath: 'id', indexes: [{ name: 'byFiredAt', keyPath: 'firedAt' }], owner: 'core' },
  { name: 'feeds', keyPath: 'id', indexes: [{ name: 'byAt', keyPath: 'at' }], owner: 'feed' },
  { name: 'weights', keyPath: 'id', indexes: [{ name: 'byAt', keyPath: 'at' }], owner: 'weight' },
]
