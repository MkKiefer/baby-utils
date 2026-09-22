import { reactive } from 'vue'

/** Persistent storage: asks the browser not to evict our IndexedDB under storage pressure. */
export const storageState = reactive({
  supported: typeof navigator !== 'undefined' && !!navigator.storage?.persist,
  persisted: null as boolean | null,
  usage: null as number | null,
  quota: null as number | null,
  details: null as Record<string, number> | null,
})

export async function refreshStorage() {
  if (!navigator.storage) return
  storageState.persisted = (await navigator.storage.persisted?.()) ?? null
  const est = (await navigator.storage.estimate?.()) as
    | (StorageEstimate & { usageDetails?: Record<string, number> })
    | undefined
  storageState.usage = est?.usage ?? null
  storageState.quota = est?.quota ?? null
  storageState.details = est?.usageDetails ?? null
}

export async function requestPersistence(): Promise<boolean> {
  const granted = (await navigator.storage?.persist?.()) ?? false
  await refreshStorage()
  return granted
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '–'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`
}
