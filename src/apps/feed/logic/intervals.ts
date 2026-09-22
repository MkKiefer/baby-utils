import type { FeedSettings } from './types'

/**
 * Default start-to-start feeding interval by age. Rough guidance for healthy term babies
 * (8–12 feeds a day in the first weeks, spacing out over the months). Not medical advice:
 * the manual mode exists for whatever the midwife or paediatrician recommends.
 */
export const AGE_INTERVALS = [
  { fromDay: 0, toDay: 13, minutes: 150, label: 'First 2 weeks' },
  { fromDay: 14, toDay: 60, minutes: 180, label: '2 weeks – 2 months' },
  { fromDay: 61, toDay: 121, minutes: 210, label: '2 – 4 months' },
  { fromDay: 122, toDay: Infinity, minutes: 240, label: '4 months +' },
] as const

/** Jaundice (Gelbsucht): frequent feeds help clear bilirubin, so never wait longer. */
export const JAUNDICE_MAX_MIN = 120
export const MANUAL_MIN = 60
export const MANUAL_MAX = 300
/** Range of the one-time "next feed in" interval. */
export const ONCE_MIN = 30
export const ONCE_MAX = 360

/** A one-time interval, capped like any other interval while jaundice is active. */
export function capOnceMin(minutes: number, settings: FeedSettings): number {
  const max = settings.jaundice.active ? JAUNDICE_MAX_MIN : ONCE_MAX
  return Math.max(ONCE_MIN, Math.min(max, Math.round(minutes)))
}

export function ageIntervalMin(ageDays: number): number {
  return (AGE_INTERVALS.find((r) => ageDays <= r.toDay) ?? AGE_INTERVALS[AGE_INTERVALS.length - 1]).minutes
}

export interface BaseInterval {
  baseMin: number
  source: 'age' | 'manual'
  /** Interval the age table suggests (for display, even in manual mode). */
  ageMin: number
  jaundiceCapped: boolean
}

export function resolveBaseInterval(settings: FeedSettings, ageDays: number | null): BaseInterval {
  const ageMin = ageIntervalMin(ageDays ?? 0)
  const chosen = settings.intervalMode === 'manual' ? settings.manualIntervalMin : ageMin
  const capped = settings.jaundice.active && chosen > JAUNDICE_MAX_MIN
  return {
    baseMin: capped ? JAUNDICE_MAX_MIN : chosen,
    source: settings.intervalMode === 'manual' ? 'manual' : 'age',
    ageMin,
    jaundiceCapped: capped,
  }
}

/** Choices for the night extension (minutes added to the interval). */
export const NIGHT_EXTRA_OPTIONS = [30, 60, 90, 120] as const

/** Whether `at` falls inside the local night window `[startMin, endMin)`, which may wrap midnight. */
export function isNightTime(at: number, startMin: number, endMin: number): boolean {
  const d = new Date(at)
  const m = d.getHours() * 60 + d.getMinutes()
  if (startMin === endMin) return false
  return startMin < endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin
}

/**
 * Extra minutes for a cycle starting at `at`. Off with jaundice: those babies must not
 * wait longer, night or not.
 */
export function nightExtraMin(settings: FeedSettings, at: number): number {
  const n = settings.night
  if (!n.enabled || settings.jaundice.active) return 0
  return isNightTime(at, n.startMin, n.endMin) ? n.extraMin : 0
}
