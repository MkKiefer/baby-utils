import { DAY, startOfDay } from '@/core/time'
import { isDirty, isWarnStool, isWet, type DiaperEntry } from './types'

/** Derived numbers for the diaper views. Pure; expects live entries only. */

/** A pale or bloody stool stays flagged on the overview this long. */
export const WARN_STOOL_MS = 14 * DAY
/** Dirty-diaper guidance ends here: older breastfed babies can go days without a stool. */
export const DIRTY_GUIDE_UNTIL_DAYS = 42

export interface DayCount {
  /** Local midnight of the day. */
  day: number
  wet: number
  dirty: number
  total: number
}

export interface DiaperStats {
  latest: DiaperEntry | null
  lastWet: DiaperEntry | null
  lastDirty: DiaperEntry | null
  today: DayCount
  /** Rolling 24 hours, which reads better than "today" shortly after midnight. */
  last24h: { wet: number; dirty: number; total: number }
  /** The last `days` local days, oldest first, today last. */
  days: DayCount[]
  /** Most recent pale or bloody stool within `WARN_STOOL_MS`. */
  warnStool: DiaperEntry | null
}

export function sortDiapers(entries: DiaperEntry[]): DiaperEntry[] {
  return [...entries].sort((a, b) => a.at - b.at || a.createdAt - b.createdAt)
}

function count(entries: DiaperEntry[]) {
  const wet = entries.filter(isWet).length
  const dirty = entries.filter(isDirty).length
  return { wet, dirty, total: entries.length }
}

/** Counts per local day, oldest first. DST-safe: days are stepped by calendar date. */
export function dayCounts(entries: DiaperEntry[], now: number, days: number): DayCount[] {
  const out: DayCount[] = []
  const d = new Date(startOfDay(now))
  d.setDate(d.getDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    const from = d.getTime()
    d.setDate(d.getDate() + 1)
    const to = d.getTime()
    out.push({ day: from, ...count(entries.filter((e) => e.at >= from && e.at < to)) })
  }
  return out
}

export function computeDiaperStats(entries: DiaperEntry[], now = Date.now(), days = 7): DiaperStats {
  const sorted = sortDiapers(entries)
  const lastOf = (pred: (e: DiaperEntry) => boolean) => sorted.findLast(pred) ?? null
  const perDay = dayCounts(sorted, now, days)
  return {
    latest: sorted.at(-1) ?? null,
    lastWet: lastOf(isWet),
    lastDirty: lastOf(isDirty),
    today: perDay.at(-1)!,
    last24h: count(sorted.filter((e) => e.at > now - DAY && e.at <= now)),
    days: perDay,
    warnStool: lastOf((e) => isWarnStool(e.stool) && e.at > now - WARN_STOOL_MS),
  }
}

/**
 * A commonly used rule of thumb for breastfed newborns: about one wet diaper per day of
 * life up to day 5, then 6 or more; a stool a day at first, then 3 or more until about six
 * weeks. `ageDays` 0 is the day of birth. Returns null for dirty once the guide no longer applies.
 */
export function expectedPerDay(ageDays: number): { wet: number; dirty: number | null } | null {
  if (ageDays < 0) return null
  const dayOfLife = ageDays + 1
  const wet = dayOfLife >= 5 ? 6 : dayOfLife
  let dirty: number | null
  if (dayOfLife <= 2) dirty = 1
  else if (dayOfLife <= 4) dirty = 2
  else if (ageDays < DIRTY_GUIDE_UNTIL_DAYS) dirty = 3
  else dirty = null
  return { wet, dirty }
}
