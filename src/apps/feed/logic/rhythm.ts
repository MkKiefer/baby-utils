import { DAY, MINUTE } from '@/core/time'
import type { FeedEntry, FeedSettings } from './types'

/**
 * Learns the baby's rhythm: how much later (or earlier) than the planned base interval
 * feeds actually happen. Shown as "2h +30m".
 */

export const RHYTHM_WINDOW_MS = 7 * DAY
export const RHYTHM_MAX_SAMPLES = 8
export const RHYTHM_MIN_SAMPLES = 3
/** Gap much longer than planned → probably an unlogged feed in between (night, half asleep). */
export const GAP_RATIO = 1.75
/** Gap much shorter than planned → cluster feeding or a double tap. */
export const CLUSTER_RATIO = 0.4

export interface RhythmSample {
  fromAt: number
  toAt: number
  actualMin: number
  plannedMin: number
  deltaMin: number
  used: boolean
  excluded?: 'gap' | 'cluster' | 'surplus'
}

export interface RhythmResult {
  offsetMin: number
  medianMin: number | null
  bounds: { min: number; max: number }
  samples: RhythmSample[]
  usedCount: number
  state: 'disabled' | 'learning' | 'active'
}

const round5 = (n: number) => Math.round(n / 5) * 5

/**
 * The positive bound keeps the offset from drifting when the parent always answers the
 * later reminder (every late answer would otherwise push the next one later still).
 */
export function rhythmBounds(baseMin: number, jaundice: boolean): { min: number; max: number } {
  return {
    min: -Math.min(30, round5(baseMin * 0.2)),
    max: jaundice ? 0 : Math.min(60, round5(baseMin * 0.25)),
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** `feeds` sorted ascending by `at`. */
export function learnRhythm(
  feeds: FeedEntry[],
  settings: FeedSettings,
  currentBaseMin: number,
  now: number,
): RhythmResult {
  const bounds = rhythmBounds(currentBaseMin, settings.jaundice.active)
  const base: RhythmResult = { offsetMin: 0, medianMin: null, bounds, samples: [], usedCount: 0, state: 'disabled' }
  if (!settings.rhythm.enabled) return base

  const since = Math.max(now - RHYTHM_WINDOW_MS, settings.rhythm.resetAt ?? 0)
  const samples: RhythmSample[] = []
  let used = 0
  for (let i = feeds.length - 1; i > 0 && samples.length < RHYTHM_MAX_SAMPLES * 2; i--) {
    const from = feeds[i - 1]
    const to = feeds[i]
    if (from.at < since) break
    const actualMin = (to.at - from.at) / MINUTE
    const plannedMin = from.plan?.baseMin || currentBaseMin
    const sample: RhythmSample = {
      fromAt: from.at,
      toAt: to.at,
      actualMin,
      plannedMin,
      deltaMin: actualMin - plannedMin,
      used: false,
    }
    if (actualMin > plannedMin * GAP_RATIO) sample.excluded = 'gap'
    else if (actualMin < plannedMin * CLUSTER_RATIO) sample.excluded = 'cluster'
    else if (used >= RHYTHM_MAX_SAMPLES) sample.excluded = 'surplus'
    else {
      sample.used = true
      used++
    }
    samples.push(sample)
  }

  const deltas = samples.filter((s) => s.used).map((s) => s.deltaMin)
  if (deltas.length < RHYTHM_MIN_SAMPLES) {
    return { ...base, samples, usedCount: deltas.length, state: 'learning' }
  }
  const med = median(deltas)
  const offsetMin = Math.max(bounds.min, Math.min(bounds.max, round5(med)))
  return { offsetMin: offsetMin === 0 ? 0 : offsetMin, medianMin: med, bounds, samples, usedCount: deltas.length, state: 'active' }
}
