import { ref } from 'vue'

export type PermissionState = NotificationPermission | 'unsupported'

function read(): PermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** Reactive notification permission, kept fresh on focus and via the Permissions API. */
export const notificationPermission = ref<PermissionState>(read())

export function refreshPermission() {
  notificationPermission.value = read()
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', refreshPermission)
  void navigator.permissions
    ?.query({ name: 'notifications' as PermissionName })
    .then((status) => {
      status.onchange = refreshPermission
    })
    .catch(() => {})
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    await Notification.requestPermission()
  } catch {
    /* old callback-style implementations */
  }
  refreshPermission()
  return notificationPermission.value
}
