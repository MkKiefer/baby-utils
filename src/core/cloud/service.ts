import { reactive } from 'vue'
import { getDB } from '../db'
import { mergeIncoming } from '../merge'
import { applySyncedDocs, demoteSyncedDocs, mergeSyncedDocs, readSyncedDocs, type SyncedDocs } from '../settingsSync'
import { emitChange, onChange, type ChangeScope } from '../sync'
import { detectPlatform } from '../platform'
import { readFeedRecords } from '@/apps/feed/logic/repo'
import { readWeightRecords } from '@/apps/weight/logic/repo'
import { normalizeServerUrl, relayClient, RelayError, type RelayServer } from './api'
import { deriveGroup, newGroupSecret, newMemberId, type GroupKeys, type Invite } from './crypto'
import { emptyState, syncRound, type CloudConfig, type CloudState, type RoundResult } from './engine'

/**
 * Optional relay sync, page side: config and state, when to run a round, and reactive
 * status for the UI. Off until the user creates or joins a group.
 *
 * Config (with the group secret) and state live in localStorage under `sync.*`, outside
 * the `bu.*` prefix, so they are not part of a backup file: restoring a backup on another
 * phone must not clone this device's group membership. The sync server (address and
 * server secret) is kept apart in `sync.server`, so it survives leaving a group.
 */

const CONFIG_KEY = 'sync.config'
const STATE_KEY = 'sync.state'
const SERVER_KEY = 'sync.server'
/** Polling while the app is visible. The relay has no push, so this is the latency. */
export const POLL_MS = 30_000
/** Wait after a local edit, so a burst of edits goes out as one message. */
const DEBOUNCE_MS = 1500
/** Local edits that have something for the group. */
const SYNCED_SCOPES: ChangeScope[] = ['feeds', 'weights', 'profile', 'feed.settings', 'weight.settings']

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

export const cloud = reactive({
  /** An empty url means this app's own address (the default server). */
  server: { url: '', key: '', ...load<RelayServer>(SERVER_KEY) } as RelayServer,
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
    localStorage.setItem(SERVER_KEY, JSON.stringify(cloud.server))
  } catch {
    // Storage full or blocked: the next round recomputes from scratch at worst.
  }
}

const relay = relayClient(() => cloud.server)
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
    if (e.code === 'bad_api_key') return 'The server secret is missing or wrong — check the sync server'
    if (e.code === 'group_full') return 'The group is full'
    if (e.code === 'rate_limited') return 'Too many requests to the sync server — retrying later'
    if (e.code === 'server_buffer_full') return 'The sync server is full — try again later'
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
              readRecords: async () => {
                const db = await getDB()
                const [feeds, weights] = await Promise.all([readFeedRecords(db), readWeightRecords(db)])
                return { feeds, weights }
              },
              merge: (incoming, from) => mergeIncoming(incoming, from, 'cloud'),
              readDocs: async () => readSyncedDocs(await getDB()),
              mergeDocs,
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

/** Takes over the group's newer settings; announces them so the stores reload. */
async function mergeDocs(incoming: SyncedDocs): Promise<number> {
  const db = await getDB()
  const count = await applySyncedDocs(db, mergeSyncedDocs(await readSyncedDocs(db), incoming))
  if (count) emitChange('all')
  return count
}

async function setup(secret: string, label: string, joining: boolean) {
  if (cloud.config) await leaveGroup()
  // A joining phone adopts the group's settings rather than pushing its own over them.
  if (joining) await demoteSyncedDocs(await getDB())
  cloud.config = { secret, memberId: newMemberId(), label: label.trim() || defaultDeviceLabel(), enabled: true, createdAt: Date.now() }
  cloud.state = emptyState()
  save()
  await syncNow()
}

export function createGroup(label: string): Promise<void> {
  return setup(newGroupSecret(), label, false)
}

/** Joins with an invite; one that carries a sync server switches this phone to it. */
export function joinGroup(invite: Invite, label: string): Promise<void> {
  if (invite.server) saveServer(invite.server)
  return setup(invite.secret, label, true)
}

/** Tells the relay to stop holding messages for this device, then forgets the group. */
export async function leaveGroup(): Promise<void> {
  const config = cloud.config
  if (!config) return
  cloud.config = null
  cloud.state = emptyState()
  save()
  try {
    await relay.leave((await groupKeys(config.secret)).token, config.memberId)
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

/** The address shown for the default server: this app's own. */
export function ownServerUrl(): string {
  return typeof location === 'undefined' ? '' : location.origin
}

/** Validates a server; the stored url stays empty when it is this app's own address. */
function checkServer(server: RelayServer): RelayServer {
  const url = server.url.trim() ? normalizeServerUrl(server.url) : ''
  if (url === null) throw new Error('The server address must start with https://')
  return { url: url === ownServerUrl() ? '' : url, key: server.key.trim() }
}

function saveServer(server: RelayServer) {
  cloud.server = checkServer(server)
  cloud.state.lastError = null
  save()
}

/** Switches to another sync server (or secret); throws when the address is not a URL. */
export function setServer(server: RelayServer) {
  saveServer(server)
  void syncNow()
}

/** Checks a server and secret without saving them (`/health` needs the secret). */
export async function testServer(server: RelayServer): Promise<string | null> {
  try {
    await relayClient(() => checkServer(server)).health()
    return null
  } catch (e) {
    return e instanceof RelayError ? describeError(e) : String((e as Error)?.message ?? e)
  }
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
    if (SYNCED_SCOPES.includes(e.scope) || (e.scope === 'all' && !cloud.syncing)) soon()
  })
  void syncNow()
}
