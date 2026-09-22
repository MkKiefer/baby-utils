import type { DB } from './db'

export interface Profile {
  name: string
  /** Local calendar date `YYYY-MM-DD`. */
  birthDate: string
  /** Optional local time `HH:MM`. */
  birthTime?: string
  createdAt: number
}

export const PROFILE_KEY = 'profile'

export async function readProfile(db: DB): Promise<Profile | null> {
  return ((await db.get('kv', PROFILE_KEY)) as Profile | undefined) ?? null
}
