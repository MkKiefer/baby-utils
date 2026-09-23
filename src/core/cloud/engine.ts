import type { FeedEntry } from '@/apps/feed/logic/types'
import type { WeightEntry } from '@/apps/weight/logic/types'
import type { IncomingRecords, MergeStats } from '../merge'
import { countFields, foldDocs, type SyncedDocs } from '../settingsSync'
import { RelayError, type RelayClient, type RelayMember, type RelayMessage } from './api'
import { decryptMessage, encryptMessage, newMemberId, type GroupKeys } from './crypto'

/**
 * One relay sync round, free of DOM and storage so it can be tested against the real relay.
 *
 * Every device remembers which version (`updatedAt`) of each synced entry (feeds and
 * weighings) the group already has —
 * because this device sent it, or because it arrived from the group. A round then:
 *
 *   1. joins the group — only when not joined yet or when the relay has dropped us; otherwise
 *      the fetch is the heartbeat, which saves a request per round,
 *   2. fetches, decrypts and merges what is owed to us, then acknowledges it (in parallel
 *      with the sending below),
 *   3. sends every entry whose version the group does not have yet,
 *   4. sends the whole log to members that joined since the last round, so a new phone
 *      gets the history the relay never buffered for it.
 *
 * Merging is the usual union by id with `updatedAt` LWW, so duplicates are harmless.
 * Synced settings ride along the same way, per field (see `settingsSync.ts`).
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
  /** Settings fields taken over from the group. */
  settingsMerged: number
  /** Settings fields sent to the whole group. */
  settingsSent: number
  /** The relay had dropped this device (inactive too long), so it joined again. */
  rejoined: boolean
}

export interface CloudState {
  /** Entry key (see `knownKey`) → version the group already has. */
  known: Record<string, number>
  /** `doc/field` → settings version the group already has. */
  knownDocs: Record<string, number>
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
  /** Added with the weight tracker; missing from older app versions, which ignore it. */
  weights?: WeightEntry[]
  /** Synced settings (see `settingsSync.ts`); missing from app versions before settings sync. */
  docs?: SyncedDocs
}

/** Every synced record on a device, tombstones included. */
export interface SyncRecords {
  feeds: FeedEntry[]
  weights: WeightEntry[]
}

export type SyncKind = keyof SyncRecords

export interface Device {
  relay: RelayClient
  readRecords(): Promise<SyncRecords>
  merge(incoming: IncomingRecords, from: number): Promise<MergeStats>
  readDocs(): Promise<SyncedDocs>
  /** Merges settings from the group; returns how many fields changed here. */
  mergeDocs(docs: SyncedDocs): Promise<number>
  now?: () => number
}

const KINDS: SyncKind[] = ['feeds', 'weights']

/** Feed ids stay unprefixed, so the `known` map of devices from before weights still applies. */
export function knownKey(kind: SyncKind, id: string): string {
  return kind === 'feeds' ? id : `weight:${id}`
}

export function recordCount(records: SyncRecords): number {
  return records.feeds.length + records.weights.length
}

/** Entries per message; a year of feeds fits a handful of messages well below the relay cap. */
export const CHUNK = 1500

export function emptyState(): CloudState {
  return {
    known: {},
    knownDocs: {},
    members: [],
    labels: {},
    joined: false,
    lastSyncAt: null,
    lastError: null,
    lastRound: null,
  }
}

function isPayload(value: unknown): value is SyncPayload {
  const p = value as SyncPayload
  return !!p && p.v === 1 && Array.isArray(p.feeds) && typeof p.sentAt === 'number'
}

/** Entries whose current version the group has not seen. */
export function pendingEntries(records: SyncRecords, known: Record<string, number>): SyncRecords {
  return {
    feeds: records.feeds.filter((e) => known[knownKey('feeds', e.id)] !== e.updatedAt),
    weights: records.weights.filter((e) => known[knownKey('weights', e.id)] !== e.updatedAt),
  }
}

function markKnown(state: CloudState, records: SyncRecords) {
  for (const kind of KINDS) for (const e of records[kind]) state.known[knownKey(kind, e.id)] = e.updatedAt
}

/** Settings fields whose current version the group has not seen. */
export function pendingDocs(docs: SyncedDocs, known: Record<string, number>): SyncedDocs {
  const out: SyncedDocs = {}
  for (const [key, fields] of Object.entries(docs)) {
    for (const [f, field] of Object.entries(fields)) {
      if (known[`${key}/${f}`] !== field.at) (out[key] ??= {})[f] = field
    }
  }
  return out
}

function markDocs(known: Record<string, number>, docs: SyncedDocs) {
  for (const [key, fields] of Object.entries(docs)) {
    for (const [f, field] of Object.entries(fields)) known[`${key}/${f}`] = field.at
  }
}

async function send(
  dev: Device,
  keys: GroupKeys,
  config: CloudConfig,
  records: SyncRecords,
  docs: SyncedDocs,
  to?: string[],
) {
  const now = dev.now?.() ?? Date.now()
  // Chunk across both kinds, so a message never exceeds CHUNK entries in total.
  const items = KINDS.flatMap((kind) => records[kind].map((entry) => ({ kind, entry })))
  let delivered = false
  for (let i = 0; i === 0 || i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK)
    const payload: SyncPayload = {
      v: 1,
      label: config.label,
      sentAt: now,
      feeds: slice.filter((x) => x.kind === 'feeds').map((x) => x.entry as FeedEntry),
      weights: slice.filter((x) => x.kind === 'weights').map((x) => x.entry as WeightEntry),
    }
    // Settings are small: they go with the first chunk only.
    if (i === 0 && countFields(docs)) payload.docs = docs
    const body = await encryptMessage(keys, config.memberId, payload)
    if ((await dev.relay.post(keys.token, config.memberId, body, to)) !== null) delivered = true
  }
  return delivered
}

export async function syncRound(dev: Device, keys: GroupKeys, config: CloudConfig, state: CloudState): Promise<RoundResult> {
  const { relay } = dev
  const g = keys.token
  const result: RoundResult = {
    at: dev.now?.() ?? Date.now(),
    received: 0,
    rejected: 0,
    sent: 0,
    snapshots: 0,
    merged: null,
    settingsMerged: 0,
    settingsSent: 0,
    rejoined: false,
  }

  // 1. Join, unless the fetch (a heartbeat too) finds us still in the group.
  let created = false
  let owed: { messages: RelayMessage[]; members: RelayMember[] } | null = null
  if (state.joined) {
    try {
      owed = await relay.fetch(g, config.memberId)
    } catch (e) {
      if (!(e instanceof RelayError && e.code === 'member_unknown')) throw e
    }
  }
  if (!owed) {
    created = (await relay.join(g, config.memberId)).created
    if (created && state.joined) {
      // The relay forgot us: what it buffered meanwhile is gone. Come back as a new member,
      // so the others notice and send their whole log, and resend ours.
      config.memberId = newMemberId()
      created = (await relay.join(g, config.memberId)).created
      Object.assign(state, { known: {}, knownDocs: {}, members: [] })
      result.rejoined = true
    }
    if (created) Object.assign(state, { known: {}, knownDocs: {} })
    state.joined = true
    owed = await relay.fetch(g, config.memberId)
  }

  // 2. Receive.
  const { messages, members } = owed
  const incoming = { feeds: [] as FeedEntry[], weights: [] as WeightEntry[] }
  const incomingDocs: unknown[] = []
  let latest = 0
  for (const msg of messages) {
    try {
      const payload = await decryptMessage(keys, msg.from, msg.body)
      if (!isPayload(payload)) throw new Error('bad payload')
      incoming.feeds.push(...payload.feeds)
      if (Array.isArray(payload.weights)) incoming.weights.push(...payload.weights)
      if (payload.docs) incomingDocs.push(payload.docs)
      if (typeof payload.label === 'string') state.labels[msg.from] = payload.label.slice(0, 40)
      latest = Math.max(latest, payload.sentAt)
      result.received++
    } catch {
      result.rejected++
    }
  }
  if (recordCount(incoming)) result.merged = await dev.merge(incoming, latest)
  const docsIn = foldDocs(incomingDocs)
  if (countFields(docsIn)) result.settingsMerged = await dev.mergeDocs(docsIn)
  // Rejected ones too: they will never decrypt, and would otherwise be held forever.
  const acked = messages.length ? relay.ack(g, config.memberId, messages.map((m) => m.id)) : Promise.resolve()
  // Awaited at the end; until then an unhandled rejection must not escape.
  acked.catch(() => {})

  // What arrived and survived the merge is known to the group already.
  const records = await dev.readRecords()
  for (const kind of KINDS) {
    const byId = new Map<string, { updatedAt: number }>(records[kind].map((e) => [e.id, e]))
    for (const e of incoming[kind]) {
      if (e && byId.get(e.id)?.updatedAt === e.updatedAt) state.known[knownKey(kind, e.id)] = e.updatedAt
    }
  }
  const docs = await dev.readDocs()
  for (const [key, fields] of Object.entries(docsIn)) {
    for (const [f, field] of Object.entries(fields)) {
      if (docs[key]?.[f]?.at === field.at) state.knownDocs[`${key}/${f}`] = field.at
    }
  }

  // 3. Send changes to everyone (on a fresh join also an empty hello, so others learn our name).
  const others = members.map((m) => m.id).filter((id) => id !== config.memberId)
  const newcomers = others.filter((id) => !state.members.includes(id))
  const delta = pendingEntries(records, state.known)
  const deltaCount = recordCount(delta)
  const docDelta = pendingDocs(docs, state.knownDocs)
  const docCount = countFields(docDelta)
  let everyoneHasAll = false
  if (others.length && (deltaCount || docCount || created)) {
    if (await send(dev, keys, config, delta, docDelta)) {
      markKnown(state, delta)
      markDocs(state.knownDocs, docDelta)
      result.sent = deltaCount
      result.settingsSent = docCount
      everyoneHasAll = deltaCount === recordCount(records) && docCount === countFields(docs)
    }
  }

  // 4. Full log and settings for members that are new to us.
  if (newcomers.length && !everyoneHasAll) {
    await send(dev, keys, config, records, docs, newcomers)
    result.snapshots = newcomers.length
  }

  await acked
  state.members = others
  for (const id of Object.keys(state.labels)) if (!others.includes(id)) delete state.labels[id]
  state.lastSyncAt = result.at
  state.lastError = null
  state.lastRound = result
  return result
}
