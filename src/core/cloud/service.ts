import { reactive } from 'vue'
import { getDB } from '../db'
import { mergeFeeds } from '../merge'
import { onChange } from '../sync'
import { detectPlatform } from '../platform'
import { readFeedRecords } from '@/apps/feed/logic/repo'
import { relayClient, RelayError } from './api'
import { deriveGroup, newGroupSecret, newMemberId, type GroupKeys } from './crypto'
import { emptyState, syncRound, type CloudConfig, type CloudState, type RoundResult } from './engine'

/**
 * Optional relay sync, page side: config and state, when to run a round, and reactive
 * status for the UI. Off until the user creates or joins a group.
 *
 * Config (with the group secret) and state live in localStorage under `sync.*`, outside
 * the `bu.*` prefix, so they are not part of a backup file: restoring a backup on another
 * phone must not clone this device's group membership.
 */

const CONFIG_KEY = 'sync.config'
const STATE_KEY = 'sync.state'
/** Polling while the app is visible. The relay has no push, so this is the latency. */
export const POLL_MS = 30_000
/** Wait after a local edit, so a burst of edits goes out as one message. */
const DEBOUNCE_MS = 1500

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

export const cloud = reactive({
  config: load<CloudConfig>(CONFIG_KEY),
  state: { ...emptyState(), ...load<CloudState>(STATE_KEY) } as CloudState,
  syncing: false,
})

/** Recent rounds of this session, for the Debug app. */
export const cloudLog: (RoundResult | { at: number; error: string })[] = []

function save() {
  try {
    if (cloud.config) localStorage.setItem(CONFIG_KEY, JSON.stringify(cloud.config))
    else localStorage.removeItem(CONFIG_KEY)
    localStorage.setItem(STATE_KEY, JSON.stringify(cloud.state))
  } catch {
    // Storage full or blocked: the next round recomputes from scratch at worst.
  }
}

const relay = relayClient()
let keys: { secret: string; value: Promise<GroupKeys> } | null = null

export function groupKeys(secret: string): Promise<GroupKeys> {
  if (keys?.secret !== secret) keys = { secret, value: deriveGroup(secret) }
  return keys.value
}

export function defaultDeviceLabel(): string {
  const { os } = detectPlatform()
  const names: Record<string, string> = { ios: 'iPhone', ipados: 'iPad', android: 'Android phone', macos: 'Mac' }
  return names[os] ?? 'This device'
}

function describeError(e: unknown): string {
  if (e instanceof RelayError) {
    if (e.code === 'offline') return 'Offline'
    if (e.code === 'group_full') return 'The group is full'
    if (e.code === 'group_buffer_full') return 'The relay is holding too much for this group — open the app on the other phones'
    if (e.status === 0) return 'Sync server not reachable'
    return `Sync server error (${e.code})`
  }
  return String((e as Error)?.message ?? e)
}

let running: Promise<void> | null = null
let again = false

/** Runs a round now (or right after the current one). */
export function syncNow(): Promise<void> {
  if (!cloud.config?.enabled) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    cloud.syncing = true
    try {
      do {
        again = false
        const config = cloud.config
        if (!config?.enabled) break
        try {
          const round = await syncRound(
            {
              relay,
              readRecords: async () => readFeedRecords(await getDB()),
              merge: (feeds, from) => mergeFeeds(feeds, from, 'cloud'),
            },
            await groupKeys(config.secret),
            config,
            cloud.state,
          )
          cloudLog.unshift(round)
        } catch (e) {
          cloud.state.lastError = describeError(e)
          cloudLog.unshift({ at: Date.now(), error: cloud.state.lastError })
        }
        cloudLog.length = Math.min(cloudLog.length, 30)
        save()
      } while (again)
    } finally {
      cloud.syncing = false
      running = null
    }
  })()
  return running
}

async function setup(secret: string, label: string) {
  if (cloud.config) await leaveGroup()
  cloud.config = { secret, memberId: newMemberId(), label: label.trim() || defaultDeviceLabel(), enabled: true, createdAt: Date.now() }
  cloud.state = emptyState()
  save()
  await syncNow()
}

export function createGroup(label: string): Promise<void> {
  return setup(newGroupSecret(), label)
}

export function joinGroup(secret: string, label: string): Promise<void> {
  return setup(secret, label)
}

/** Tells the relay to stop holding messages for this device, then forgets the group. */
export async function leaveGroup(): Promise<void> {
  const config = cloud.config
  if (!config) return
  cloud.config = null
  cloud.state = emptyState()
  save()
  try {
    await relay.leave((await groupKeys(config.secret)).groupId, config.memberId)
  } catch {
    // Offline: the relay drops us after 30 days without polling anyway.
  }
}

export function setEnabled(enabled: boolean) {
  if (!cloud.config) return
  cloud.config.enabled = enabled
  save()
  if (enabled) void syncNow()
}

export function setLabel(label: string) {
  if (!cloud.config || !label.trim()) return
  cloud.config.label = label.trim().slice(0, 40)
  save()
}

export function relayHealth() {
  return relay.health()
}

let started = false

/** Schedules rounds: on start, while visible, when online again and after local edits. */
export function startCloudSync() {
  if (started || typeof document === 'undefined') return
  started = true
  let debounce: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow(), DEBOUNCE_MS)
  }

  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  addEventListener('online', () => void syncNow())
  onChange((e) => {
    // A merge from our own round announces 'all'; do not answer it with another round.
    if (e.scope === 'feeds' || (e.scope === 'all' && !cloud.syncing)) soon()
  })
  void syncNow()
}
