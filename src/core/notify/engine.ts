import type { DB } from '../db'
import { providers } from '@/apps/providers'
import type { NotifLogEntry, PlannedNotification } from './types'
import { DAY, MINUTE } from '../time'

/**
 * Context-independent notification engine, shared by the page scheduler and the service
 * worker. It evaluates every provider, decides which reminders are due and records each
 * decision in `notifLog`, which is also the lock that stops page and SW double-firing.
 */

/** Late by at most this much → still show, even if the app is on screen. */
export const GRACE_MS = 2 * MINUTE
/** Late by more than this → never show, the moment has passed. */
export const STALE_MS = 45 * MINUTE

export interface Plan {
  notifications: PlannedNotification[]
  badge: number
  errors: { provider: string; error: string }[]
}

export async function collectPlan(db: DB, now: number): Promise<Plan> {
  const plan: Plan = { notifications: [], badge: 0, errors: [] }
  for (const provider of providers) {
    try {
      const result = await provider.plan(db, now)
      plan.notifications.push(...result.notifications)
      plan.badge += result.badge
    } catch (e) {
      plan.errors.push({ provider: provider.id, error: String(e) })
    }
  }
  plan.notifications.sort((a, b) => a.at - b.at)
  return plan
}

export function notificationOptions(n: PlannedNotification): NotificationOptions {
  // `actions`, `renotify`, `vibrate` and `timestamp` are missing from lib.dom but work
  // where supported and are ignored elsewhere.
  const options: NotificationOptions & Record<string, unknown> = {
    body: n.body,
    tag: n.tag,
    renotify: true,
    requireInteraction: n.requireInteraction ?? false,
    icon: '/pwa-192x192.png',
    badge: '/badge-96.png',
    vibrate: [180, 90, 180, 90, 360],
    timestamp: n.at,
    data: { id: n.id, url: n.url, source: n.source, kind: n.kind },
    actions: n.actions ?? [],
  }
  return options
}

type Decision = { n: PlannedNotification; show: boolean; reason?: string }

/** Pure decision step: which due, unhandled reminders to show and which to skip. */
export function decide(
  due: PlannedNotification[],
  now: number,
  appVisible: boolean,
): Decision[] {
  const latestByTag = new Map<string, PlannedNotification>()
  for (const n of due) {
    const cur = latestByTag.get(n.tag)
    if (!cur || n.at > cur.at) latestByTag.set(n.tag, n)
  }
  return due.map((n) => {
    if (latestByTag.get(n.tag) !== n) return { n, show: false, reason: 'superseded' }
    const late = now - n.at
    if (late > STALE_MS) return { n, show: false, reason: 'stale' }
    if (appVisible && late > GRACE_MS) return { n, show: false, reason: 'app-visible' }
    return { n, show: true }
  })
}

/** Atomically reserve a log slot; false if another context already handled this id. */
async function claim(db: DB, entry: NotifLogEntry): Promise<boolean> {
  const tx = db.transaction('notifLog', 'readwrite')
  const existing = await tx.store.get(entry.id)
  if (existing) {
    await tx.done
    return false
  }
  await tx.store.put(entry)
  await tx.done
  return true
}

export interface ProcessOptions {
  via: 'page' | 'sw'
  appVisible: boolean
  canNotify: boolean
  show: (n: PlannedNotification) => Promise<void>
}

export interface ProcessResult {
  plan: Plan
  shown: string[]
  skipped: string[]
  next: PlannedNotification | null
}

export async function processDue(db: DB, now: number, opts: ProcessOptions): Promise<ProcessResult> {
  const plan = await collectPlan(db, now)
  const handled = new Set(await db.getAllKeys('notifLog'))
  const due = plan.notifications.filter((n) => n.at <= now && !handled.has(n.id))
  const result: ProcessResult = { plan, shown: [], skipped: [], next: null }

  for (const d of decide(due, now, opts.appVisible)) {
    const show = d.show && opts.canNotify
    const entry: NotifLogEntry = {
      id: d.n.id,
      at: d.n.at,
      firedAt: now,
      status: show ? 'pending' : 'skipped',
      reason: d.reason ?? (show ? undefined : 'no-permission'),
      title: d.n.title,
      body: d.n.body,
      tag: d.n.tag,
      source: d.n.source,
      kind: d.n.kind,
      via: opts.via,
    }
    if (!(await claim(db, entry))) continue
    if (!show) {
      result.skipped.push(d.n.id)
      continue
    }
    try {
      await opts.show(d.n)
      await db.put('notifLog', { ...entry, status: 'shown' })
      result.shown.push(d.n.id)
    } catch (e) {
      await db.put('notifLog', { ...entry, status: 'failed', reason: String(e) })
    }
  }

  result.next = plan.notifications.find((n) => n.at > now && !handled.has(n.id)) ?? null
  return result
}

export async function pruneLog(db: DB, now: number, keepMs = 14 * DAY): Promise<number> {
  const tx = db.transaction('notifLog', 'readwrite')
  let removed = 0
  let cursor = await tx.store.index('byFiredAt').openCursor(IDBKeyRange.upperBound(now - keepMs))
  while (cursor) {
    await cursor.delete()
    removed++
    cursor = await cursor.continue()
  }
  await tx.done
  return removed
}

/** Updates the installed app's icon badge where supported. */
export async function applyBadge(count: number): Promise<'set' | 'cleared' | 'unsupported'> {
  // Works for both `Navigator` (page) and `WorkerNavigator` (service worker).
  const nav = (
    globalThis as {
      navigator?: { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    }
  ).navigator
  if (!nav?.setAppBadge || !nav.clearAppBadge) return 'unsupported'
  try {
    if (count > 0) {
      await nav.setAppBadge(count)
      return 'set'
    }
    await nav.clearAppBadge()
    return 'cleared'
  } catch {
    return 'unsupported'
  }
}
