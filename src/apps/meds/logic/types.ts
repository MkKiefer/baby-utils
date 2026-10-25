/**
 * A medication plan: what to give, how often and for how long. Doses are logged against a
 * plan. Both are synced logs (union by id, newest `updatedAt` wins, tombstones).
 */
export interface MedPlan {
  id: string
  /** e.g. "Amoxicillin". */
  name: string
  /** Free text amount, e.g. "2.5 ml" or "1 drop each eye". */
  dose?: string
  /** First day of the course: local midnight (epoch ms). Named `at` like every synced log. */
  at: number
  /**
   * Doses per dose day. For `asNeeded` plans this is the daily maximum instead.
   */
  timesPerDay: number
  /** 1 = every day, 2 = every other day, 7 = once a week… */
  everyDays: number
  /** Length of the course in calendar days, counted from `at`. Missing = ongoing. */
  days?: number
  /** Optional fixed clock times ("HH:MM"), one per dose; enables reminders. */
  times?: string[]
  /** Remind at the fixed times (needs `times`). */
  remind?: boolean
  /** Given when needed, up to `timesPerDay` a day, instead of on a schedule. */
  asNeeded?: boolean
  /** Ended before the planned last day (epoch ms). */
  stoppedAt?: number
  note?: string
  source: 'app' | 'import'
  createdAt: number
  /** Last local change (epoch ms); decides which copy wins a merge. See `core/merge.ts`. */
  updatedAt: number
  /** Soft delete (epoch ms), kept so the deletion survives a merge. */
  deletedAt?: number
}

export interface MedDose {
  id: string
  planId: string
  /** When it was given (or would have been, for a skipped dose). */
  at: number
  /** Name and amount at the time of logging, shown if the plan is gone. */
  name: string
  dose?: string
  /** A planned dose that was deliberately not given (counts as handled, not as given). */
  skipped?: boolean
  note?: string
  source: 'app' | 'import' | 'notification'
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/** Accent of the sub-app; also set on sheets, which are teleported out of the sub-app frame. */
export const MEDS_ACCENT = '#E0699A'

/** Notification action "Given" on a medication reminder. */
export const MED_GIVEN_ACTION = 'med-given'

export const EVERY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Every day' },
  { value: 2, label: 'Every 2nd day' },
  { value: 3, label: 'Every 3rd day' },
  { value: 7, label: 'Once a week' },
]

export const MAX_TIMES_PER_DAY = 12
