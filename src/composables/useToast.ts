import { reactive } from 'vue'

export interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
  tone?: 'default' | 'ok' | 'warn'
  timeout: number
}

export const toasts = reactive<Toast[]>([])
let seq = 0

export function dismissToast(id: number) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) {
  const t: Toast = { id: ++seq, message, timeout: opts.action ? 6000 : 3200, ...opts }
  toasts.push(t)
  if (toasts.length > 3) toasts.shift()
  setTimeout(() => dismissToast(t.id), t.timeout)
  return t.id
}
