import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHandler, PREFIX } from '../../../server/http.ts'
import { SyncStore } from '../../../server/store.ts'
import { mergeFeedRecords } from '../merge'
import type { FeedEntry } from '@/apps/feed/logic/types'
import { relayClient, type RelayClient } from './api'
import {
  decryptMessage,
  deriveGroup,
  encryptMessage,
  inviteFor,
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
    expect(a.groupId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.groupId).not.toContain(secret)
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

  it('parses invites and bare secrets', () => {
    const secret = newGroupSecret()
    expect(parseInvite(inviteFor(secret))).toBe(secret)
    expect(parseInvite(` ${secret.slice(0, 20)}\n${secret.slice(20)} `)).toBe(secret)
    expect(parseInvite('hello')).toBeNull()
  })
})

// ---------------------------------------------------------------------------- engine

function feed(id: string, at: number, extra: Partial<FeedEntry> = {}): FeedEntry {
  return { id, at, source: 'app', createdAt: at, updatedAt: at, plan: { baseMin: 180, offsetMin: 0 }, ...extra }
}

class Phone {
  records = new Map<string, FeedEntry>()
  state: CloudState = emptyState()
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
      readRecords: async () => [...this.records.values()],
      merge: async (incoming) => {
        const { writes, stats } = mergeFeedRecords([...this.records.values()], incoming)
        for (const e of writes) this.records.set(e.id, e)
        return stats
      },
    }
  }

  add(e: FeedEntry) {
    this.records.set(e.id, e)
  }

  sync() {
    return syncRound(this.device, this.keys, this.config, this.state)
  }

  live() {
    return [...this.records.values()].filter((e) => !e.deletedAt).map((e) => e.id).sort()
  }
}

describe('relay sync', () => {
  let server: Server
  let relay: RelayClient
  const store = new SyncStore()

  beforeAll(async () => {
    server = createServer(createHandler(store))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    relay = relayClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}${PREFIX}`)
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

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
    // Someone who learned the group id (e.g. the relay itself) but not the key.
    const intruder = newMemberId()
    await relay.join(keys.groupId, intruder)
    const forged = await encryptMessage(await deriveGroup(newGroupSecret()), intruder, {
      v: 1,
      label: 'evil',
      sentAt: 0,
      feeds: [feed('evil', 1)],
    })
    await relay.post(keys.groupId, intruder, forged)
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
})
