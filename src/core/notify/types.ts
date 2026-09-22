import type { DB } from '../db'

/** A notification a sub-app wants shown at a certain time. Must be deterministic. */
export interface PlannedNotification {
  /** Stable id: the same reminder must produce the same id on every evaluation (dedupe). */
  id: string
  at: number
  title: string
  body: string
  /** Notifications sharing a tag replace each other in the tray. */
  tag: string
  /** Sub-app id. */
  source: string
  /** Provider-specific label, e.g. `base` or `due`. */
  kind: string
  /** Route opened when the notification is tapped. */
  url: string
  actions?: { action: string; title: string }[]
  requireInteraction?: boolean
}

export interface ProviderResult {
  notifications: PlannedNotification[]
  /** Contribution to the app icon badge. */
  badge: number
}

export interface NotificationProvider {
  id: string
  plan(db: DB, now: number): Promise<ProviderResult>
}

export type NotifStatus = 'pending' | 'shown' | 'skipped' | 'failed'

export interface NotifLogEntry {
  id: string
  /** Planned time. */
  at: number
  firedAt: number
  status: NotifStatus
  reason?: string
  title: string
  body: string
  tag: string
  source: string
  kind: string
  via: 'page' | 'sw' | 'test'
}
