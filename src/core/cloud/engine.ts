import type { FeedEntry } from '@/apps/feed/logic/types'
import type { MergeStats } from '../merge'
import type { RelayClient } from './api'
import { decryptMessage, encryptMessage, newMemberId, type GroupKeys } from './crypto'

/**
 * One relay sync round, free of DOM and storage so it can be tested against the real relay.
 *
 * Every device remembers which version (`updatedAt`) of each feed the group already has —
 * because this device sent it, or because it arrived from the group. A round then:
 *
 *   1. joins the group (a heartbeat; also tells us if the relay had dropped us),
 *   2. fetches, decrypts and merges what is owed to us, then acknowledges it,
 *   3. sends every entry whose version the group does not have yet,
 *   4. sends the whole log to members that joined since the last round, so a new phone
 *      gets the history the relay never buffered for it.
 *
 * Merging is the usual union by id with `updatedAt` LWW, so duplicates are harmless.
 */

export interface CloudConfig {
  secret: string
  memberId: string
  /** Shown to the other members; travels encrypted. */
  label: string
  enabled: boolean
  createdAt: number
}

export interface RoundResult {
  at: number
  received: number
  /** Messages that failed to decrypt or validate (wrong key, altered). */
  rejected: number
  /** Entries sent to the whole group. */
  sent: number
  /** Members that got a full-log snapshot. */
  snapshots: number
  merged: MergeStats | null
  /** The relay had dropped this device (inactive too long), so it joined again. */
  rejoined: boolean
}

export interface CloudState {
  /** Feed id → version the group already has. */
  known: Record<string, number>
  /** The other members at the end of the last round. */
  members: string[]
  /** Other members' device names, from their decrypted messages. */
  labels: Record<string, string>
  /** This device has joined the relay at least once with the current member id. */
  joined: boolean
  lastSyncAt: number | null
  lastError: string | null
  lastRound: RoundResult | null
}

export interface SyncPayload {
  v: 1
  label: string
  sentAt: number
  feeds: FeedEntry[]
}

export interface Device {
  relay: RelayClient
  readRecords(): Promise<FeedEntry[]>
  merge(feeds: unknown[], from: number): Promise<MergeStats>
  now?: () => number
}

/** Entries per message; a year of feeds fits a handful of messages well below the relay cap. */
export const CHUNK = 1500

export function emptyState(): CloudState {
  return { known: {}, members: [], labels: {}, joined: false, lastSyncAt: null, lastError: null, lastRound: null }
}

function isPayload(value: unknown): value is SyncPayload {
  const p = value as SyncPayload
  return !!p && p.v === 1 && Array.isArray(p.feeds) && typeof p.sentAt === 'number'
}

/** Entries whose current version the group has not seen. */
export function pendingEntries(records: FeedEntry[], known: Record<string, number>): FeedEntry[] {
  return records.filter((e) => known[e.id] !== e.updatedAt)
}

async function send(dev: Device, keys: GroupKeys, config: CloudConfig, feeds: FeedEntry[], to?: string[]) {
  const now = dev.now?.() ?? Date.now()
  let delivered = false
  for (let i = 0; i === 0 || i < feeds.length; i += CHUNK) {
    const payload: SyncPayload = { v: 1, label: config.label, sentAt: now, feeds: feeds.slice(i, i + CHUNK) }
    const body = await encryptMessage(keys, config.memberId, payload)
    if ((await dev.relay.post(keys.groupId, config.memberId, body, to)) !== null) delivered = true
  }
  return delivered
}

export async function syncRound(dev: Device, keys: GroupKeys, config: CloudConfig, state: CloudState): Promise<RoundResult> {
  const { relay } = dev
  const g = keys.groupId
  const result: RoundResult = {
    at: dev.now?.() ?? Date.now(),
    received: 0,
    rejected: 0,
    sent: 0,
    snapshots: 0,
    merged: null,
    rejoined: false,
  }

  // 1. Join / heartbeat.
  let { created } = await relay.join(g, config.memberId)
  if (created && state.joined) {
    // The relay forgot us: what it buffered meanwhile is gone. Come back as a new member,
    // so the others notice and send their whole log, and resend ours.
    config.memberId = newMemberId()
    created = (await relay.join(g, config.memberId)).created
    Object.assign(state, { known: {}, members: [] })
    result.rejoined = true
  }
  if (created) state.known = {}
  state.joined = true

  // 2. Receive.
  const { messages, members } = await relay.fetch(g, config.memberId)
  const incoming: FeedEntry[] = []
  let latest = 0
  for (const msg of messages) {
    try {
      const payload = await decryptMessage(keys, msg.from, msg.body)
      if (!isPayload(payload)) throw new Error('bad payload')
      incoming.push(...payload.feeds)
      if (typeof payload.label === 'string') state.labels[msg.from] = payload.label.slice(0, 40)
      latest = Math.max(latest, payload.sentAt)
      result.received++
    } catch {
      result.rejected++
    }
  }
  if (incoming.length) result.merged = await dev.merge(incoming, latest)
  // Rejected ones too: they will never decrypt, and would otherwise be held forever.
  if (messages.length) await relay.ack(g, config.memberId, messages.map((m) => m.id))

  // What arrived and survived the merge is known to the group already.
  const records = await dev.readRecords()
  const byId = new Map(records.map((e) => [e.id, e]))
  for (const e of incoming) {
    if (e && byId.get(e.id)?.updatedAt === e.updatedAt) state.known[e.id] = e.updatedAt
  }

  // 3. Send changes to everyone (on a fresh join also an empty hello, so others learn our name).
  const others = members.map((m) => m.id).filter((id) => id !== config.memberId)
  const newcomers = others.filter((id) => !state.members.includes(id))
  const delta = pendingEntries(records, state.known)
  let everyoneHasAll = false
  if (others.length && (delta.length || created)) {
    if (await send(dev, keys, config, delta)) {
      for (const e of delta) state.known[e.id] = e.updatedAt
      result.sent = delta.length
      everyoneHasAll = delta.length === records.length
    }
  }

  // 4. Full log for members that are new to us.
  if (newcomers.length && !everyoneHasAll) {
    await send(dev, keys, config, records, newcomers)
    result.snapshots = newcomers.length
  }

  state.members = others
  for (const id of Object.keys(state.labels)) if (!others.includes(id)) delete state.labels[id]
  state.lastSyncAt = result.at
  state.lastError = null
  state.lastRound = result
  return result
}
