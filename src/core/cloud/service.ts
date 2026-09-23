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
/** Polling while the app is visible and the relay's event stream is not up. */
export const POLL_MS = 30_000
/** Safety-net polling while the event stream is up; the stream brings changes right away. */
export const STREAM_POLL_MS = 5 * 60_000
/** Wait after a local edit, so a burst of edits goes out as one message. */
const DEBOUNCE_MS = 800
/** Wait after a stream event, so a message sent in several chunks is fetched in one round. */
const NUDGE_MS = 250
/** Reconnect delays of the event stream (doubling up to the maximum). */
const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 60_000
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
  /** The relay's event stream (see `watch` below), for the UI and the Debug app. */
  stream: {
    status: 'off' as 'off' | 'connecting' | 'open' | 'retrying' | 'unsupported',
    openedAt: null as number | null,
    events: 0,
    lastEventAt: null as number | null,
    connects: 0,
    lastError: null as string | null,
  },
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
        // A first join or a rejoin (new member id) changes what the stream listens to.
        ensureWatch()
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
  ensureWatch()
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
  ensureWatch()
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
  // Another server may well have the event stream.
  if (cloud.stream.status === 'unsupported') cloud.stream.status = 'off'
  save()
  ensureWatch()
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

// ---------------------------------------------------------------------------- event stream

let watch: { key: string; ctrl: AbortController } | null = null
let nudge: ReturnType<typeof setTimeout> | undefined

/** What the stream should listen to right now; empty when it should be closed. */
function watchKey(): string {
  const c = cloud.config
  if (!c?.enabled || !cloud.state.joined || cloud.stream.status === 'unsupported') return ''
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return ''
  return JSON.stringify([cloud.server, c.secret, c.memberId])
}

/** Opens, reopens or closes the event stream to match the config and visibility. */
function ensureWatch() {
  if (!started) return
  const key = watchKey()
  if (watch?.key === key) return
  watch?.ctrl.abort()
  watch = null
  if (cloud.stream.status !== 'unsupported') cloud.stream.status = 'off'
  cloud.stream.openedAt = null
  if (!key) return
  watch = { key, ctrl: new AbortController() }
  void runWatch(watch.ctrl.signal)
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })
}

/**
 * Keeps the stream open, reconnecting with a growing delay. Each event runs a round; so
 * does every (re)connect, which picks up whatever was sent while the stream was down.
 */
async function runWatch(signal: AbortSignal) {
  const config = cloud.config!
  const { token } = await groupKeys(config.secret)
  const s = cloud.stream
  let delay = RETRY_MIN_MS
  while (!signal.aborted) {
    const opened = Date.now()
    s.status = 'connecting'
    try {
      await relay.watch(
        token,
        config.memberId,
        (event) => {
          if (event === 'ready') {
            Object.assign(s, { status: 'open', openedAt: Date.now(), lastError: null })
            s.connects++
            void syncNow()
            return
          }
          s.events++
          s.lastEventAt = Date.now()
          clearTimeout(nudge)
          nudge = setTimeout(() => void syncNow(), NUDGE_MS)
        },
        signal,
      )
      s.lastError = 'Closed by the server'
    } catch (e) {
      if (signal.aborted) return
      s.lastError = describeError(e)
      if (e instanceof RelayError && e.code === 'not_found') {
        // A relay from before event streams: stay with polling.
        s.status = 'unsupported'
        watch = null
        return
      }
      // The relay dropped us: the round rejoins, and ensureWatch then follows the new id.
      if (e instanceof RelayError && e.code === 'member_unknown') void syncNow()
    }
    if (signal.aborted) return
    s.status = 'retrying'
    s.openedAt = null
    if (Date.now() - opened > RETRY_MAX_MS) delay = RETRY_MIN_MS
    await pause(delay, signal)
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
}

let started = false

/**
 * Schedules rounds: on start, on every event of the relay's stream, when visible again, when
 * online again and after local edits — plus polling as a fallback.
 */
export function startCloudSync() {
  if (started || typeof document === 'undefined') return
  started = true
  let debounce: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow(), DEBOUNCE_MS)
  }

  setInterval(() => {
    if (document.visibilityState !== 'visible') return
    const streaming = cloud.stream.status === 'open'
    if (!streaming || Date.now() - (cloud.state.lastSyncAt ?? 0) >= STREAM_POLL_MS) void syncNow()
  }, POLL_MS)
  document.addEventListener('visibilitychange', () => {
    // Hidden: close the stream (the OS would suspend it anyway). Visible: reopen, and sync.
    ensureWatch()
    if (document.visibilityState === 'visible') void syncNow()
  })
  addEventListener('online', () => {
    // Reconnect right away instead of waiting out the retry delay.
    watch?.ctrl.abort()
    watch = null
    ensureWatch()
    void syncNow()
  })
  onChange((e) => {
    // A merge from our own round announces 'all'; do not answer it with another round.
    if (SYNCED_SCOPES.includes(e.scope) || (e.scope === 'all' && !cloud.syncing)) soon()
  })
  ensureWatch()
  void syncNow()
}
