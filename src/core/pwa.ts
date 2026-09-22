import { markRaw, reactive } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import { PERIODIC_SYNC_TAG } from './constants'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type PeriodicSyncManager = {
  register(tag: string, opts: { minInterval: number }): Promise<void>
  getTags(): Promise<string[]>
}

export const installState = reactive({
  canPrompt: false,
  justInstalled: false,
  outcome: '' as string,
})

export const swState = reactive({
  needRefresh: false,
  offlineReady: false,
  registration: null as ServiceWorkerRegistration | null,
  scriptUrl: '',
  error: '',
  periodicSync: '' as string,
})

let deferredPrompt: BeforeInstallPromptEvent | null = null

/** Must run early: browsers fire `beforeinstallprompt` shortly after load. */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    installState.canPrompt = true
  })
  window.addEventListener('appinstalled', () => {
    installState.justInstalled = true
    installState.canPrompt = false
    deferredPrompt = null
  })
}

export async function promptInstall() {
  if (!deferredPrompt) return
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  installState.outcome = choice.outcome
  if (choice.outcome === 'accepted') installState.canPrompt = false
  deferredPrompt = null
}

let updateSW: ((reload?: boolean) => Promise<void>) | null = null

export function initServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    swState.error = 'Service workers are not supported'
    return
  }
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => (swState.needRefresh = true),
    onOfflineReady: () => (swState.offlineReady = true),
    onRegisteredSW(url, reg) {
      swState.scriptUrl = url
      if (!reg) return
      swState.registration = markRaw(reg)
      void registerPeriodicSync(reg)
      setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000)
    },
    onRegisterError: (e) => (swState.error = String(e)),
  })
}

export function applyUpdate() {
  void updateSW?.(true)
}

export function periodicSyncManager(reg: ServiceWorkerRegistration | null): PeriodicSyncManager | null {
  return (reg as unknown as { periodicSync?: PeriodicSyncManager } | null)?.periodicSync ?? null
}

/**
 * Best effort (Chromium, installed apps only). The browser decides the real frequency
 * based on engagement — usually hours, so it complements rather than replaces the page timer.
 */
export async function registerPeriodicSync(reg: ServiceWorkerRegistration) {
  const manager = periodicSyncManager(reg)
  if (!manager) {
    swState.periodicSync = 'unsupported'
    return
  }
  try {
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName })
    if (status.state !== 'granted') {
      swState.periodicSync = `permission ${status.state}`
      return
    }
    await manager.register(PERIODIC_SYNC_TAG, { minInterval: 15 * 60 * 1000 })
    swState.periodicSync = 'registered'
  } catch (e) {
    swState.periodicSync = String(e)
  }
}
