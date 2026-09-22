/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'
import { getDB } from './core/db'
import { emitChange } from './core/sync'
import { applyBadge, collectPlan, notificationOptions, processDue } from './core/notify/engine'
import { PERIODIC_SYNC_TAG } from './core/constants'
import { addFeed } from './apps/feed/logic/repo'
import { FED_ACTION } from './apps/feed/logic/plan'

declare const self: ServiceWorkerGlobalScope

// --- Offline: precache the whole build, serve the SPA shell for navigations ----------
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
clientsClaim()

async function appVisible(): Promise<boolean> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.some((c) => c.visibilityState === 'visible')
}

/** Same engine as the page; the notifLog lock prevents double notifications. */
async function checkReminders() {
  const db = await getDB()
  const res = await processDue(db, Date.now(), {
    via: 'sw',
    appVisible: await appVisible(),
    canNotify: Notification.permission === 'granted',
    show: (n) => self.registration.showNotification(n.title, notificationOptions(n)),
  })
  await applyBadge(res.plan.badge)
}

// --- Periodic Background Sync (Chromium, installed app, browser-chosen frequency) ----
self.addEventListener('periodicsync', (event) => {
  const e = event as ExtendableEvent & { tag: string }
  if (e.tag === PERIODIC_SYNC_TAG) e.waitUntil(checkReminders())
})

// --- Notification clicks --------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  const data = (notification.data ?? {}) as { url?: string }
  notification.close()

  event.waitUntil(
    (async () => {
      if (event.action === FED_ACTION) {
        const db = await getDB()
        await addFeed(db, { at: Date.now(), source: 'notification' })
        emitChange('feeds')
        const plan = await collectPlan(db, Date.now())
        await applyBadge(plan.badge)
        return
      }
      const url = data.url ?? '/'
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows[0]
      if (client) {
        await client.focus()
        client.postMessage({ type: 'navigate', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
