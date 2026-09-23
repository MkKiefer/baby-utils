import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../../server/src/app.ts'
import { groupIdFor } from '../../../server/src/auth.ts'
import { SyncStore } from '../../../server/src/store.ts'
import { mergeFeedRecords, mergeWeightRecords } from '../merge'
import { countFields, mergeSyncedDocs, type SyncedDocs } from '../settingsSync'
import type { FeedEntry } from '@/apps/feed/logic/types'
import type { WeightEntry } from '@/apps/weight/logic/types'
import { normalizeServerUrl, readEvents, relayBase, relayClient, RelayError, type RelayClient, type RelayEvent } from './api'
import {
  decryptMessage,
  deriveGroup,
  encryptMessage,
  inviteFor,
  MAX_PLAIN_BYTES,
  newGroupSecret,
  newMemberId,
  parseInvite,
  type GroupKeys,
} from './crypto'
import { emptyState, syncRound, type CloudConfig, type CloudState, type Device } from './engine'

describe('crypto', () => {
  it('derives the same group on every device, and a different one per secret', async () => {
    const secret = newGroupSecret()
    const a = await deriveGroup(secret)
    const b = await deriveGroup(secret)
    expect(a.groupId).toBe(b.groupId)
    expect(a.token).toBe(b.token)
    expect(a.groupId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.groupId).not.toContain(secret)
    expect(a.token).not.toBe(secret)
    // The relay files the group under the same id the phones bind into every message.
    expect(groupIdFor(a.token)).toBe(a.groupId)
    expect((await deriveGroup(newGroupSecret())).groupId).not.toBe(a.groupId)
  })

  it('round-trips a message and rejects the wrong key, sender or a flipped bit', async () => {
    const keys = await deriveGroup(newGroupSecret())
    const from = newMemberId()
    const body = await encryptMessage(keys, from, { hello: 'world' })
    expect(body).not.toContain('world')
    expect(await decryptMessage(keys, from, body)).toEqual({ hello: 'world' })

    await expect(decryptMessage(await deriveGroup(newGroupSecret()), from, body)).rejects.toThrow()
    await expect(decryptMessage(keys, newMemberId(), body)).rejects.toThrow()
    const flipped = body.slice(0, -2) + (body.at(-2) === 'A' ? 'B' : 'A') + body.at(-1)
    await expect(decryptMessage(keys, from, flipped)).rejects.toThrow()
  })

  it('refuses to inflate a message beyond the size cap', async () => {
    const keys = await deriveGroup(newGroupSecret())
    const from = newMemberId()
    // Highly compressible: a few KB of ciphertext that would inflate past the cap.
    const body = await encryptMessage(keys, from, 'a'.repeat(MAX_PLAIN_BYTES + 1))
    expect(body.length).toBeLessThan(200_000)
    await expect(decryptMessage(keys, from, body)).rejects.toThrow('Message too large')
  })

  it('parses invites and bare secrets', () => {
    const secret = newGroupSecret()
    expect(parseInvite(inviteFor(secret))).toEqual({ secret })
    expect(parseInvite(` ${secret.slice(0, 20)}\n${secret.slice(20)} `)).toEqual({ secret })
    expect(parseInvite('hello')).toBeNull()
  })

  it('carries the sync server in a version 2 invite', () => {
    const secret = newGroupSecret()
    const server = { url: 'https://sync.example.com', key: 'k€y with spaces' }
    const invite = inviteFor(secret, server)
    expect(invite.startsWith('baby-utils-sync:2:')).toBe(true)
    expect(parseInvite(invite)).toEqual({ secret, server })
    expect(parseInvite(invite.slice(0, -4))).toBeNull()
  })
})

describe('event stream parsing', () => {
  it('reports named events across chunk borders and skips comments', async () => {
    const text = ['event: rea', 'dy\ndata: {}\n\n: ping\n\n', 'event: message\r\ndata: {}\r\n\r\nevent: member\ndata: {}\n\n']
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const t of text) c.enqueue(new TextEncoder().encode(t))
        c.close()
      },
    })
    const events: RelayEvent[] = []
    await readEvents(body, (e) => events.push(e))
    expect(events).toEqual(['ready', 'message', 'member'])
  })
})

describe('server address', () => {
  it('normalises what the user types', () => {
    expect(normalizeServerUrl(' https://a.example/ ')).toBe('https://a.example')
    expect(normalizeServerUrl('https://a.example/sub/api/sync/v2/')).toBe('https://a.example/sub')
    expect(normalizeServerUrl('ftp://a.example')).toBeNull()
    expect(normalizeServerUrl('a.example')).toBeNull()
    expect(relayBase({ url: 'https://a.example/', key: '' })).toBe('https://a.example/api/sync/v2')
  })
})

// ---------------------------------------------------------------------------- engine

function feed(id: string, at: number, extra: Partial<FeedEntry> = {}): FeedEntry {
  return { id, at, source: 'app', createdAt: at, updatedAt: at, plan: { baseMin: 180, offsetMin: 0 }, ...extra }
}

function weighing(id: string, at: number, grams: number, extra: Partial<WeightEntry> = {}): WeightEntry {
  return { id, at, grams, source: 'app', createdAt: at, updatedAt: at, ...extra }
}

class Phone {
  records = new Map<string, FeedEntry>()
  weights = new Map<string, WeightEntry>()
  state: CloudState = emptyState()
  docs: SyncedDocs = {}
  config: CloudConfig
  device: Device

  constructor(
    relay: RelayClient,
    readonly keys: GroupKeys,
    secret: string,
    label: string,
  ) {
    this.config = { secret, memberId: newMemberId(), label, enabled: true, createdAt: 0 }
    this.device = {
      relay,
      readRecords: async () => ({ feeds: [...this.records.values()], weights: [...this.weights.values()] }),
      merge: async (incoming) => {
        const feeds = mergeFeedRecords([...this.records.values()], incoming.feeds)
        for (const e of feeds.writes) this.records.set(e.id, e)
        const weights = mergeWeightRecords([...this.weights.values()], incoming.weights)
        for (const e of weights.writes) this.weights.set(e.id, e)
        return { ...feeds.stats, added: feeds.stats.added + weights.stats.added }
      },
      readDocs: async () => structuredClone(this.docs),
      mergeDocs: async (incoming) => {
        const changes = mergeSyncedDocs(this.docs, incoming)
        for (const [key, fields] of Object.entries(changes)) Object.assign((this.docs[key] ??= {}), fields)
        return countFields(changes)
      },
    }
  }

  add(e: FeedEntry) {
    this.records.set(e.id, e)
  }

  set(key: string, field: string, value: unknown, at: number) {
    ;(this.docs[key] ??= {})[field] = { at, value }
  }

  get(key: string, field: string) {
    return this.docs[key]?.[field]?.value
  }

  sync() {
    return syncRound(this.device, this.keys, this.config, this.state)
  }

  live() {
    return [...this.records.values()].filter((e) => !e.deletedAt).map((e) => e.id).sort()
  }
}

describe('relay sync', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let relay: RelayClient
  let url = ''
  const store = new SyncStore()
  const KEY = 'server-secret-for-tests'

  beforeAll(async () => {
    app = await createApp({ apiKey: KEY }, store)
    await app.listen(0, '127.0.0.1')
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1')
    relay = relayClient(() => ({ url, key: KEY }))
  })
  afterAll(() => app.close())

  it('is refused without the right server secret', async () => {
    const { keys } = await group()
    const stranger = relayClient(() => ({ url, key: 'not-the-server-secret' }))
    const err = await stranger.join(keys.token, newMemberId()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RelayError)
    expect((err as RelayError).code).toBe('bad_api_key')
    expect(store.hasGroup(keys.groupId)).toBe(false)
  })

  async function group(...labels: string[]) {
    const secret = newGroupSecret()
    const keys = await deriveGroup(secret)
    return { keys, phones: labels.map((l) => new Phone(relay, keys, secret, l)) }
  }

  it('brings two phones and a late third one to the same log', async () => {
    const { keys, phones } = await group('A', 'B', 'C')
    const [a, b, c] = phones as [Phone, Phone, Phone]
    a.add(feed('a1', 1000))
    a.add(feed('a2', 2000))
    b.add(feed('b1', 1500))

    await a.sync() // alone: nothing to deliver
    await b.sync() // joins, sends b1, sees newcomer-to-it A (already covered by the full delta)
    await a.sync() // gets b1, sees B as newcomer → sends its log
    await b.sync()
    expect(a.live()).toEqual(['a1', 'a2', 'b1'])
    expect(b.live()).toEqual(['a1', 'a2', 'b1'])
    expect(a.state.labels).toEqual({ [b.config.memberId]: 'B' })

    // The relay only ever holds ciphertext.
    for (const g of Object.values(store.state.groups)) {
      for (const m of g.messages) expect(m.body).not.toMatch(/a1|b1/)
    }

    // An edit and a delete travel as new versions.
    a.add(feed('a1', 1000, { updatedAt: 5000, note: 'long one' }))
    b.add(feed('b1', 1500, { updatedAt: 6000, deletedAt: 6000 }))
    await a.sync()
    await b.sync()
    await a.sync()
    expect(b.records.get('a1')?.note).toBe('long one')
    expect(a.live()).toEqual(['a1', 'a2'])

    // C joins much later and still receives the whole history.
    await c.sync()
    await a.sync()
    await b.sync()
    await c.sync()
    expect(c.live()).toEqual(['a1', 'a2'])
    expect(c.records.get('b1')?.deletedAt).toBe(6000)

    // Everything delivered: the relay holds nothing for this group any more.
    await a.sync()
    await b.sync()
    await c.sync()
    expect(store.state.groups[keys.groupId]!.messages).toEqual([])
  })

  it('syncs weighings alongside feeds, edits and deletes included', async () => {
    const { phones } = await group('A', 'B')
    const [a, b] = phones as [Phone, Phone]
    a.add(feed('f1', 1000))
    a.weights.set('w1', weighing('w1', 1000, 3450))
    await a.sync()
    await b.sync()
    await a.sync()
    await b.sync()
    expect(b.weights.get('w1')?.grams).toBe(3450)
    expect(b.live()).toEqual(['f1'])

    b.weights.set('w1', weighing('w1', 1000, 3405, { updatedAt: 5000 }))
    b.weights.set('w2', weighing('w2', 9000, 3500))
    await b.sync()
    await a.sync()
    expect(a.weights.get('w1')?.grams).toBe(3405)
    expect(a.weights.get('w2')?.grams).toBe(3500)

    a.weights.set('w2', weighing('w2', 9000, 3500, { updatedAt: 9500, deletedAt: 9500 }))
    await a.sync()
    await b.sync()
    expect(b.weights.get('w2')?.deletedAt).toBe(9500)
    // Everything known: nothing left to send on either side.
    expect((await a.sync()).sent).toBe(0)
    expect((await b.sync()).sent).toBe(0)
  })

  it('accepts messages from app versions that predate weights', async () => {
    const { keys, phones } = await group('A', 'B')
    const [a] = phones as [Phone, Phone]
    await a.sync()
    const old = newMemberId()
    await relay.join(keys.token, old)
    await a.sync()
    const body = await encryptMessage(keys, old, { v: 1, label: 'old', sentAt: 1, feeds: [feed('o1', 1)] })
    await relay.post(keys.token, old, body)
    const round = await a.sync()
    expect(round.rejected).toBe(0)
    expect(a.live()).toEqual(['o1'])
  })

  it('buffers while a phone is away', async () => {
    const { keys, phones } = await group('A', 'B')
    const [a, b] = phones as [Phone, Phone]
    await a.sync()
    await b.sync()
    await a.sync()
    for (let i = 0; i < 5; i++) {
      a.add(feed(`x${i}`, 10_000 + i))
      await a.sync()
    }
    expect(store.state.groups[keys.groupId]!.messages.length).toBeGreaterThan(0)
    await b.sync()
    expect(b.live()).toEqual(['x0', 'x1', 'x2', 'x3', 'x4'])
    expect(store.state.groups[keys.groupId]!.messages).toEqual([])
  })

  it('ignores messages from a device without the secret', async () => {
    const { keys, phones } = await group('A', 'B')
    const [a, b] = phones as [Phone, Phone]
    await a.sync()
    await b.sync()
    // Someone who learned the relay token (e.g. the relay itself) but not the key.
    const intruder = newMemberId()
    await relay.join(keys.token, intruder)
    const forged = await encryptMessage(await deriveGroup(newGroupSecret()), intruder, {
      v: 1,
      label: 'evil',
      sentAt: 0,
      feeds: [feed('evil', 1)],
    })
    await relay.post(keys.token, intruder, forged)
    const round = await a.sync()
    expect(round.rejected).toBe(1)
    expect(a.records.has('evil')).toBe(false)
  })

  it('rejoins as a new member when the relay dropped it', async () => {
    const { keys, phones } = await group('A', 'B')
    const [a, b] = phones as [Phone, Phone]
    a.add(feed('a1', 1))
    await a.sync()
    await b.sync()
    await a.sync()
    await b.sync()
    const oldId = b.config.memberId
    store.leave(keys.groupId, oldId) // what pruning does
    a.add(feed('a2', 2))
    await a.sync() // nobody to deliver to

    const round = await b.sync()
    expect(round.rejoined).toBe(true)
    expect(b.config.memberId).not.toBe(oldId)
    await a.sync()
    await b.sync()
    expect(b.live()).toEqual(['a1', 'a2'])
  })

  it('needs no join request once joined: the fetch is the heartbeat', async () => {
    const { phones } = await group('A', 'B')
    const [a, b] = phones as [Phone, Phone]
    for (const p of [a, b, a, b]) await p.sync() // settled: hellos and snapshots delivered
    const calls: string[] = []
    a.device.relay = new Proxy(relay, {
      get: (target, key: keyof RelayClient) => (...args: never[]) => {
        calls.push(key)
        return (target[key] as (...a: never[]) => unknown)(...args)
      },
    })
    await a.sync()
    expect(calls).toEqual(['fetch'])
  })

  it('nudges a watching phone as soon as something is sent to it', async () => {
    const { keys, phones } = await group('A', 'B', 'C')
    const [a, b, c] = phones as [Phone, Phone, Phone]
    await a.sync()
    await b.sync()
    await a.sync()
    const events: RelayEvent[] = []
    const ctrl = new AbortController()
    const until = (e: RelayEvent) =>
      vi.waitFor(() => expect(events).toContain(e), { timeout: 2000, interval: 10 })
    const watching = relay.watch(keys.token, b.config.memberId, (e) => events.push(e), ctrl.signal).catch(() => {})
    await until('ready')

    a.add(feed('n1', 1))
    await a.sync()
    await until('message')
    await c.sync() // a newcomer: B should send it the log
    await until('member')
    ctrl.abort()
    await watching

    // Unknown members get no stream.
    const err = await relay.watch(keys.token, newMemberId(), () => {}, new AbortController().signal).catch((e: unknown) => e)
    expect((err as RelayError).code).toBe('member_unknown')
  })

  it('syncs settings per field, newest change winning', async () => {
    const { phones } = await group('A', 'B', 'C')
    const [a, b, c] = phones as [Phone, Phone, Phone]
    a.set('feed.settings', 'intervalMode', 'manual', 10)
    a.set('feed.settings', 'manualIntervalMin', 150, 10)
    b.set('feed.settings', 'intervalMode', 'auto', 0) // default, never touched
    await a.sync()
    await b.sync()
    await a.sync()
    await b.sync()
    expect(b.get('feed.settings', 'intervalMode')).toBe('manual')
    expect(b.get('feed.settings', 'manualIntervalMin')).toBe(150)

    // Different fields changed on both phones at once: both changes survive.
    a.set('feed.settings', 'manualIntervalMin', 165, 20)
    b.set('profile', 'name', 'Mia', 21)
    b.set('weight.settings', 'unit', 'lb', 21)
    const round = await a.sync()
    await b.sync()
    await a.sync()
    expect(round.settingsSent).toBe(1)
    for (const p of [a, b]) {
      expect(p.get('feed.settings', 'manualIntervalMin')).toBe(165)
      expect(p.get('profile', 'name')).toBe('Mia')
      expect(p.get('weight.settings', 'unit')).toBe('lb')
    }

    // A late phone gets every setting in its snapshot.
    await c.sync()
    await a.sync()
    await c.sync()
    expect(c.docs).toEqual(a.docs)

    // Nothing is resent once the group has it.
    expect((await a.sync()).settingsSent).toBe(0)
  })
})
