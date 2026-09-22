import { reactive } from 'vue'
import { getDB } from '../db'
import { onChange } from '../sync'
import { applyBadge, notificationOptions, processDue, pruneLog } from './engine'
import { notificationPermission, refreshPermission } from './permission'
import type { PlannedNotification } from './types'

/**
 * Page-side scheduler. Keeps one timer aimed at the next planned notification and
 * re-evaluates at least every 30 s, on focus/visibility and whenever data changes.
 * Browsers pause timers of suspended apps; the engine then skips stale reminders.
 */

const MAX_SLEEP_MS = 30_000

export const schedulerState = reactive({
  running: false,
  lastRunAt: 0,
  nextAt: null as number | null,
  nextTitle: '',
  lastShown: [] as string[],
  lastSkipped: [] as string[],
  badge: 0,
  badgeStatus: '' as string,
  errors: [] as { provider: string; error: string }[],
  runs: 0,
})

let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | null = null

export async function showNotification(n: PlannedNotification): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration()
  if (reg) {
    await reg.showNotification(n.title, notificationOptions(n))
    return
  }
  // Fallback without service worker (e.g. some dev setups): no actions support.
  const { actions: _actions, ...rest } = notificationOptions(n) as NotificationOptions & { actions?: unknown }
  new Notification(n.title, rest)
}

async function run() {
  clearTimeout(timer)
  refreshPermission()
  const db = await getDB()
  const now = Date.now()
  try {
    const res = await processDue(db, now, {
      via: 'page',
      appVisible: document.visibilityState === 'visible',
      canNotify: notificationPermission.value === 'granted',
      show: showNotification,
    })
    Object.assign(schedulerState, {
      lastRunAt: now,
      nextAt: res.next?.at ?? null,
      nextTitle: res.next?.title ?? '',
      lastShown: res.shown.length ? res.shown : schedulerState.lastShown,
      lastSkipped: res.skipped.length ? res.skipped : schedulerState.lastSkipped,
      badge: res.plan.badge,
      errors: res.plan.errors,
      runs: schedulerState.runs + 1,
    })
    schedulerState.badgeStatus = await applyBadge(res.plan.badge)
    const delay = res.next ? Math.min(res.next.at - Date.now(), MAX_SLEEP_MS) : MAX_SLEEP_MS
    timer = setTimeout(refreshSchedule, Math.max(delay, 250))
  } catch (e) {
    schedulerState.errors = [{ provider: 'scheduler', error: String(e) }]
    timer = setTimeout(refreshSchedule, MAX_SLEEP_MS)
  }
}

let rerun = false

/** Re-evaluate now. Calls during a run trigger exactly one follow-up run. */
export function refreshSchedule(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = run().finally(() => {
    running = null
    if (rerun) {
      rerun = false
      void refreshSchedule()
    }
  })
  return running
}

export function startScheduler() {
  if (schedulerState.running) return
  schedulerState.running = true
  document.addEventListener('visibilitychange', () => void refreshSchedule())
  window.addEventListener('focus', () => void refreshSchedule())
  onChange(() => void refreshSchedule())
  void refreshSchedule()
  void getDB().then((db) => pruneLog(db, Date.now()))
}
