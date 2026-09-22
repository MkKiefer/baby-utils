/**
 * Change notifications between the page, other tabs and the service worker.
 * `emitChange` informs local listeners immediately and every other context through a
 * BroadcastChannel. Works in window and worker scopes.
 */
export type ChangeScope = 'profile' | 'feeds' | 'feed.settings' | 'notifications' | 'all'

export interface ChangeMessage {
  type: 'changed'
  scope: ChangeScope
  origin: string
  at: number
}

export interface ChangeEvent extends ChangeMessage {
  local: boolean
}

const CHANNEL_NAME = 'baby-utils'
const origin = Math.random().toString(36).slice(2, 8)
const listeners = new Set<(event: ChangeEvent) => void>()

/** Last messages for the Debug app. */
export const syncLog: ChangeEvent[] = []

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (e: MessageEvent<ChangeMessage>) => {
    if (e.data?.type !== 'changed' || e.data.origin === origin) return
    dispatch({ ...e.data, local: false })
  }
  return channel
}

function dispatch(event: ChangeEvent) {
  syncLog.unshift(event)
  syncLog.length = Math.min(syncLog.length, 50)
  for (const fn of listeners) fn(event)
}

export function emitChange(scope: ChangeScope) {
  const msg: ChangeMessage = { type: 'changed', scope, origin, at: Date.now() }
  getChannel()?.postMessage(msg)
  dispatch({ ...msg, local: true })
}

export function onChange(fn: (event: ChangeEvent) => void): () => void {
  getChannel()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const syncInfo = { channel: CHANNEL_NAME, origin }
