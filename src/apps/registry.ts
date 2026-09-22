import type { SubApp } from './types'
import { feedApp } from './feed/manifest'
import { debugApp } from './debug/manifest'

/**
 * Sub-apps shown on the home screen, in order. To add one: create `src/apps/<id>/`,
 * export a manifest, list it here, register SW-safe providers in `providers.ts`, and add
 * any new IndexedDB stores to `core/schema.ts` (bump DB_VERSION).
 */
export const subApps: SubApp[] = [feedApp, debugApp]

export function findApp(id: string): SubApp | undefined {
  return subApps.find((a) => a.id === id)
}
