import type { PlannedNotification } from '@/core/notify/types'
import { formatClock, formatDuration, formatOffset, MINUTE } from '@/core/time'
import { capOnceMin, nightExtraMin, resolveBaseInterval, type BaseInterval } from './intervals'
import { learnRhythm, type RhythmResult } from './rhythm'
import type { FeedEntry, FeedSettings } from './types'

export type FeedStatus = 'empty' | 'ok' | 'soon' | 'due' | 'overdue' | 'paused'

/** "Soon" starts this long before the first reminder of a cycle. */
export const SOON_MS = 15 * MINUTE
/** "Due" turns into "overdue" after this long. */
export const DUE_WINDOW_MS = 30 * MINUTE
export const FEED_TAG = 'feed'
export const FED_ACTION = 'feed-fed'

/**
 * A reminder cycle. Cycle 1 follows the last logged feed; if nobody confirms, the app
 * assumes an unlogged feed happened at `dueAt` and starts the next cycle from there.
 */
export interface FeedCycle {
  index: number
  startAt: number
  baseAt: number
  dueAt: number
  /** Base interval of this cycle, including the night extension. */
  baseMin: number
  totalMin: number
  /** Night extension included in `baseMin` (0 by day). */
  nightMin: number
  /** Rhythm offset applied to this cycle (0 when the interval was set by hand). */
  offsetMin: number
  /** This cycle uses the one-time interval set on the last feed. */
  once: boolean
}

export interface FeedPlan {
  now: number
  lastFeed: FeedEntry | null
  ageDays: number | null
  interval: BaseInterval
  rhythm: RhythmResult
  /** Base interval of the current cycle, including `nightMin`. */
  baseMin: number
  /** Night extension of the current cycle (0 by day or when night mode is off). */
  nightMin: number
  /** Rhythm offset of the current cycle; `rhythm.offsetMin` is the learned value. */
  offsetMin: number
  totalMin: number
  /** One-time interval for the current cycle (from `lastFeed.nextIntervalMin`), else null. */
  onceMin: number | null
  cycles: FeedCycle[]
  status: FeedStatus
  /** Cycles whose due time passed without a logged feed. */
  unanswered: number
  remindersEnabled: boolean
  notifications: PlannedNotification[]
  nextReminder: PlannedNotification | null
}

export interface FeedPlanInput {
  feeds: FeedEntry[]
  settings: FeedSettings
  ageDays: number | null
  now: number
}

export function sortFeeds(feeds: FeedEntry[]): FeedEntry[] {
  return [...feeds].sort((a, b) => a.at - b.at)
}

export function computeFeedPlan({ feeds, settings, ageDays, now }: FeedPlanInput): FeedPlan {
  const sorted = sortFeeds(feeds)
  const lastFeed = sorted[sorted.length - 1] ?? null
  const interval = resolveBaseInterval(settings, ageDays)
  const rhythm = learnRhythm(sorted, settings, interval.baseMin, now)
  const onceMin = lastFeed?.nextIntervalMin ? capOnceMin(lastFeed.nextIntervalMin, settings) : null
  const cycleAt = (startAt: number, once: number | null = null) => {
    if (once) return { baseMin: once, nightMin: 0, offsetMin: 0, totalMin: once, once: true }
    const nightMin = nightExtraMin(settings, startAt)
    const baseMin = interval.baseMin + nightMin
    const offsetMin = rhythm.offsetMin
    return { baseMin, nightMin, offsetMin, totalMin: Math.max(30, baseMin + offsetMin), once: false }
  }
  const { baseMin, nightMin, offsetMin, totalMin } = cycleAt(lastFeed?.at ?? now, onceMin)
  const remindersEnabled = settings.maxUnconfirmed > 0

  const plan: FeedPlan = {
    now,
    lastFeed,
    ageDays,
    interval,
    rhythm,
    baseMin,
    nightMin,
    offsetMin,
    totalMin,
    onceMin,
    cycles: [],
    status: 'empty',
    unanswered: 0,
    remindersEnabled,
    notifications: [],
    nextReminder: null,
  }
  if (!lastFeed) return plan

  const cycleCount = Math.max(1, settings.maxUnconfirmed)
  let startAt = lastFeed.at
  for (let i = 0; i < cycleCount; i++) {
    // The one-time interval covers only the first cycle; later ones fall back to the plan.
    const c = cycleAt(startAt, i === 0 ? onceMin : null)
    const dueAt = startAt + c.totalMin * MINUTE
    plan.cycles.push({ index: i + 1, startAt, baseAt: startAt + c.baseMin * MINUTE, dueAt, ...c })
    startAt = dueAt
  }
  plan.unanswered = plan.cycles.filter((c) => now >= c.dueAt).length

  const first = plan.cycles[0]
  const last = plan.cycles[plan.cycles.length - 1]
  const firstReminder = Math.min(first.baseAt, first.dueAt)
  if (remindersEnabled && now >= last.dueAt + DUE_WINDOW_MS) plan.status = 'paused'
  else if (now < firstReminder - SOON_MS) plan.status = 'ok'
  else if (now < first.dueAt) plan.status = 'soon'
  else if (now < first.dueAt + DUE_WINDOW_MS) plan.status = 'due'
  else plan.status = 'overdue'

  if (remindersEnabled) {
    plan.notifications = buildNotifications(plan, lastFeed, settings)
    plan.nextReminder = plan.notifications.find((n) => n.at > now) ?? null
  }
  return plan
}

function buildNotifications(plan: FeedPlan, lastFeed: FeedEntry, settings: FeedSettings): PlannedNotification[] {
  const lastClock = formatClock(lastFeed.at)
  const out: PlannedNotification[] = []
  const common = {
    tag: FEED_TAG,
    source: 'feed',
    url: '/app/feed',
    actions: [{ action: FED_ACTION, title: 'Fed now' }],
  }
  // Editing the last feed's time must re-arm reminders, so the time is part of the id.
  // Same for setting or clearing the one-time interval.
  const idBase = `feed:${lastFeed.id}@${lastFeed.at}${plan.onceMin ? `+${plan.onceMin}` : ''}`

  for (const cycle of plan.cycles) {
    const isFirst = cycle.index === 1
    const isLast = cycle.index === plan.cycles.length
    const quietNote = isLast ? ' Reminders pause until the next feed is logged.' : ''
    const { baseMin, totalMin, nightMin, offsetMin } = cycle
    const nightText = nightMin ? `, incl. ${formatOffset(nightMin)} at night` : ''
    const intervalText = cycle.once
      ? `${formatDuration(baseMin)}, set once`
      : (offsetMin ? `${formatDuration(baseMin)} ${formatOffset(offsetMin)}` : formatDuration(baseMin)) + nightText

    if (offsetMin > 0 && settings.notifyAtBase) {
      out.push({
        ...common,
        id: `${idBase}:c${cycle.index}:base`,
        kind: 'base',
        at: cycle.baseAt,
        title: isFirst ? 'Feeding time by age' : 'Feeding time by age (no feed logged)',
        body:
          `${formatDuration(baseMin)}${nightText} since ${isFirst ? `the last feed at ${lastClock}` : 'the expected feed'}. ` +
          `Baby's rhythm usually adds ${formatOffset(offsetMin)} — next reminder at ${formatClock(cycle.dueAt)}.`,
      })
    }
    out.push({
      ...common,
      id: `${idBase}:c${cycle.index}:due`,
      kind: 'due',
      at: cycle.dueAt,
      requireInteraction: true,
      title: isFirst ? 'Time to feed' : 'Still time to feed?',
      body: isFirst
        ? `Last feed at ${lastClock}, ${formatDuration(totalMin)} ago (interval ${intervalText}).`
        : `No feed logged since ${lastClock}. Tap "Fed now" if you already fed.${quietNote}`,
    })
    if (isFirst && isLast && quietNote) out[out.length - 1].body += quietNote
  }
  return out.sort((a, b) => a.at - b.at)
}

export function badgeFor(plan: FeedPlan): number {
  return plan.status === 'due' || plan.status === 'overdue' ? 1 : 0
}
