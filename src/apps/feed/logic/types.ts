export type FeedKind = 'left' | 'right' | 'bottle'

export interface FeedEntry {
  id: string
  /** When feeding started (epoch ms). */
  at: number
  kind?: FeedKind
  note?: string
  source: 'app' | 'notification' | 'import'
  createdAt: number
  /**
   * Last local change (epoch ms). Merging a backup from another device keeps whichever
   * version of an entry was edited last. See `core/merge.ts`.
   */
  updatedAt: number
  /**
   * Soft delete (epoch ms). Deleted entries are tombstoned rather than removed, so the
   * deletion survives a merge instead of being resurrected by the other device.
   */
  deletedAt?: number
  /** Interval that applied *after* this feed, snapshotted when it was logged. */
  plan: { baseMin: number; offsetMin: number }
}

export interface FeedSettings {
  intervalMode: 'auto' | 'manual'
  manualIntervalMin: number
  jaundice: { active: boolean; since: number | null }
  rhythm: { enabled: boolean; resetAt: number | null }
  /** When the rhythm pushes the reminder later, still remind at the age-based time. */
  notifyAtBase: boolean
  /** Reminder cycles without a logged feed before going quiet (0 = reminders off). */
  maxUnconfirmed: number
}

export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  intervalMode: 'auto',
  manualIntervalMin: 180,
  jaundice: { active: false, since: null },
  rhythm: { enabled: true, resetAt: null },
  notifyAtBase: true,
  maxUnconfirmed: 2,
}

export const FEED_SETTINGS_KEY = 'feed.settings'

export const KIND_LABEL: Record<FeedKind, string> = {
  left: 'Left',
  right: 'Right',
  bottle: 'Bottle',
}
