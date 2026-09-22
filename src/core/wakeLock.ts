import { reactive } from 'vue'

/** Screen Wake Lock (keeps the screen on in night mode). Re-acquired when the app returns. */
export const wakeLockState = reactive({
  supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
  wanted: false,
  active: false,
  acquiredAt: null as number | null,
  releases: 0,
  error: '',
})

let sentinel: WakeLockSentinel | null = null

async function acquire() {
  if (!wakeLockState.supported || !wakeLockState.wanted || sentinel || document.visibilityState !== 'visible') return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    wakeLockState.active = true
    wakeLockState.acquiredAt = Date.now()
    wakeLockState.error = ''
    sentinel.addEventListener('release', () => {
      sentinel = null
      wakeLockState.active = false
      wakeLockState.releases++
    })
  } catch (e) {
    wakeLockState.error = String(e)
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => void acquire())
}

export async function requestWakeLock() {
  wakeLockState.wanted = true
  await acquire()
}

export async function releaseWakeLock() {
  wakeLockState.wanted = false
  await sentinel?.release()
  sentinel = null
}
