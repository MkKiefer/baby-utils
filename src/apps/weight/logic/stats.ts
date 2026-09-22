import { DAY } from '@/core/time'
import type { WeightEntry } from './types'

/** Derived numbers for the weight views. Pure; expects live entries only. */

/** A weighing this close to birth is treated as the birth weight. */
export const BIRTH_WINDOW_MS = 2 * DAY
/** The daily gain looks back at least this far, so two weighings a day apart don't swing it. */
export const RATE_MIN_SPAN_MS = 3 * DAY
/** …and at most this far, so the rate reflects the current trend. */
export const RATE_MAX_SPAN_MS = 14 * DAY

export interface WeightStats {
  latest: WeightEntry | null
  previous: WeightEntry | null
  /** Grams since the previous weighing. */
  change: number | null
  /** Grams per day over the recent window, and the window it was measured over. */
  rate: { gramsPerDay: number; fromAt: number; toAt: number } | null
  /** Earliest weighing within `BIRTH_WINDOW_MS` of birth, if any. */
  birth: WeightEntry | null
  /** Latest relative to birth weight, in percent (−7.5 = 7.5 % below). */
  vsBirthPct: number | null
  /** Lowest weight since birth and when, while it is below birth weight. */
  lowest: WeightEntry | null
  /** Birth weight regained: the first weighing at or above it after the dip. */
  regainedAt: number | null
}

export function sortWeights(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort((a, b) => a.at - b.at || a.createdAt - b.createdAt)
}

/** Grams per day between the latest entry and one 3–14 days before it. */
export function recentRate(sorted: WeightEntry[]): WeightStats['rate'] {
  const latest = sorted.at(-1)
  if (!latest) return null
  let from: WeightEntry | null = null
  for (let i = sorted.length - 2; i >= 0; i--) {
    const e = sorted[i]!
    const span = latest.at - e.at
    if (span > RATE_MAX_SPAN_MS) break
    from = e
    if (span >= RATE_MIN_SPAN_MS) break
  }
  // Fall back to the previous weighing when nothing lies in the window.
  from ??= sorted.at(-2) ?? null
  if (!from || latest.at - from.at < DAY / 2) return null
  return { gramsPerDay: ((latest.grams - from.grams) / (latest.at - from.at)) * DAY, fromAt: from.at, toAt: latest.at }
}

export function computeWeightStats(entries: WeightEntry[], birthMs: number | null): WeightStats {
  const sorted = sortWeights(entries)
  const latest = sorted.at(-1) ?? null
  const previous = sorted.at(-2) ?? null
  const first = sorted[0]
  const birth = birthMs != null && first && Math.abs(first.at - birthMs) <= BIRTH_WINDOW_MS ? first : null

  let lowest: WeightEntry | null = null
  let regainedAt: number | null = null
  if (birth) {
    for (const e of sorted) {
      if (e === birth) continue
      if (e.grams < birth.grams && !regainedAt && (!lowest || e.grams < lowest.grams)) lowest = e
      if (lowest && !regainedAt && e.grams >= birth.grams) regainedAt = e.at
    }
  }

  return {
    latest,
    previous,
    change: latest && previous ? latest.grams - previous.grams : null,
    rate: recentRate(sorted),
    birth,
    vsBirthPct: birth && latest && latest !== birth ? ((latest.grams - birth.grams) / birth.grams) * 100 : null,
    lowest,
    regainedAt,
  }
}
