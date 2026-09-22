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
  /**
   * One-time interval (start-to-start minutes) for the feed after this one, set by hand.
   * Replaces age, night and rhythm for that single cycle only; the next logged feed
   * goes back to the normal plan. Lives on the entry so it syncs with it.
   */
  nextIntervalMin?: number
}

export interface FeedSettings {
  intervalMode: 'auto' | 'manual'
  manualIntervalMin: number
  jaundice: { active: boolean; since: number | null }
  rhythm: { enabled: boolean; resetAt: number | null }
  /**
   * Longer interval for feeds that start at night. `startMin`/`endMin` are minutes after
   * local midnight; the window may wrap past midnight (22:00 → 06:00).
   */
  night: { enabled: boolean; startMin: number; endMin: number; extraMin: number }
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
  night: { enabled: false, startMin: 22 * 60, endMin: 6 * 60, extraMin: 60 },
  notifyAtBase: true,
  maxUnconfirmed: 2,
}

export const FEED_SETTINGS_KEY = 'feed.settings'

export const KIND_LABEL: Record<FeedKind, string> = {
  left: 'Left',
  right: 'Right',
  bottle: 'Bottle',
}
