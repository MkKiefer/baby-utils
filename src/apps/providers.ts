import type { NotificationProvider } from '@/core/notify/types'
import { feedNotificationProvider } from './feed/logic/repo'

/**
 * Notification providers of all sub-apps. Imported by the service worker, so only
 * DOM/Vue-free modules may be referenced here. Register new sub-apps here.
 */
export const providers: NotificationProvider[] = [feedNotificationProvider]
