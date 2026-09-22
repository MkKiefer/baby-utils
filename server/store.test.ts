import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createHandler, groupIdFor, PREFIX, RateLimiter, type HandlerOptions } from './http.ts'
import { LIMITS, SyncError, SyncStore } from './store.ts'

const G = 'g'.repeat(43)
const A = 'a'.repeat(22)
const B = 'b'.repeat(22)
const C = 'c'.repeat(22)

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t }
  return c
}

describe('SyncStore', () => {
  it('buffers a message until every recipient acknowledged it', () => {
    const store = new SyncStore()
    store.join(G, A)
    store.join(G, B)
    store.join(G, C)
    const id = store.post(G, A, 'cipher')!

    expect(store.fetch(G, A).messages).toEqual([])
    expect(store.fetch(G, B).messages.map((m) => m.id)).toEqual([id])
    store.ack(G, B, [id])
    expect(store.fetch(G, B).messages).toEqual([])
    expect(store.fetch(G, C).messages.map((m) => m.body)).toEqual(['cipher'])
    store.ack(G, C, [id])
    expect(store.state.groups[G]!.messages).toEqual([])
  })

  it('does not buffer for members that join later', () => {
    const store = new SyncStore()
    store.join(G, A)
    store.join(G, B)
    store.post(G, A, 'before')
    expect(store.join(G, C).created).toBe(true)
    expect(store.fetch(G, C).messages).toEqual([])
  })

  it('addresses a message to chosen members only', () => {
    const store = new SyncStore()
    for (const m of [A, B, C]) store.join(G, m)
    store.post(G, A, 'snapshot', [C])
    expect(store.fetch(G, B).messages).toEqual([])
    expect(store.fetch(G, C).messages).toHaveLength(1)
  })

  it('keeps nothing when there is nobody to deliver to', () => {
    const store = new SyncStore()
    store.join(G, A)
    expect(store.post(G, A, 'alone')).toBeNull()
    expect(store.state.groups[G]!.messages).toEqual([])
  })

  it('rejects non-members and malformed bodies', () => {
    const store = new SyncStore()
    store.join(G, A)
    expect(() => store.post(G, B, 'x')).toThrow(SyncError)
    expect(() => store.fetch(G, B)).toThrow('member_unknown')
    expect(() => store.post(G, A, 'not base64!')).toThrow('bad_body')
  })

  it('reports a heartbeat as not created', () => {
    const store = new SyncStore()
    expect(store.join(G, A).created).toBe(true)
    expect(store.join(G, A).created).toBe(false)
  })

  it('releases messages when a member leaves, and deletes an empty group', () => {
    const store = new SyncStore()
    store.join(G, A)
    store.join(G, B)
    store.post(G, A, 'x')
    store.leave(G, B)
    expect(store.state.groups[G]!.messages).toEqual([])
    store.leave(G, A)
    expect(store.state.groups[G]).toBeUndefined()
  })

  it('prunes members that stopped polling', () => {
    const c = clock()
    const store = new SyncStore(undefined, c.now)
    store.join(G, A)
    store.join(G, B)
    store.post(G, A, 'x')
    c.t += LIMITS.memberTtlMs - 1
    store.fetch(G, A)
    c.t += 2
    expect(store.prune()).toBe(1)
    expect(Object.keys(store.state.groups[G]!.members)).toEqual([A])
    expect(store.state.groups[G]!.messages).toEqual([])
  })

  it('caps group size', () => {
    const store = new SyncStore()
    for (let i = 0; i < LIMITS.membersPerGroup; i++) store.join(G, String(i).padStart(22, 'm'))
    expect(() => store.join(G, A)).toThrow('group_full')
  })
})

describe('HTTP', () => {
  let server: Server
  let base = ''
  let store: SyncStore
  const T = 't'.repeat(43)

  async function start(options?: HandlerOptions) {
    store = new SyncStore()
    server = createServer(createHandler(store, options))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${PREFIX}`
  }
  afterEach(() => new Promise<void>((r) => server.close(() => r())))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = any
  const json = async (method: string, path: string, body?: unknown, token: string | null = T) => {
    const res = await fetch(base + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data: Json = text ? JSON.parse(text) : undefined
    return { status: res.status, json: async () => data }
  }

  it('runs a join → post → fetch → ack round trip', async () => {
    await start()
    expect((await json('POST', `/members/${A}`)).status).toBe(200)
    const joined = await (await json('POST', `/members/${B}`)).json()
    expect(joined.members).toHaveLength(2)

    const posted = await json('POST', '/messages', { from: A, body: 'abc' })
    expect(posted.status).toBe(201)
    const { id } = await posted.json()

    const got = await (await json('GET', `/messages?member=${B}`)).json()
    expect(got.messages).toEqual([expect.objectContaining({ id, from: A, body: 'abc' })])

    expect((await json('POST', '/ack', { member: B, ids: [id] })).status).toBe(204)
    expect((await (await json('GET', `/messages?member=${B}`)).json()).messages).toEqual([])
    expect((await (await json('GET', '/health')).json()).messages).toBe(0)
  })

  it('files a group under the hash of its token, never the token itself', async () => {
    await start()
    await json('POST', `/members/${A}`)
    expect(Object.keys(store.state.groups)).toEqual([groupIdFor(T)])
    expect(JSON.stringify(store.state)).not.toContain(T)
  })

  it('refuses group routes without a valid token', async () => {
    await start()
    await json('POST', `/members/${A}`)
    const none = await json('GET', `/messages?member=${A}`, undefined, null)
    expect(none.status).toBe(401)
    expect(await none.json()).toEqual({ error: 'unauthorized' })
    expect((await json('POST', `/members/${B}`, undefined, 'short')).status).toBe(401)
    // Knowing the group id (the relay's name for it) is not enough.
    expect((await json('DELETE', `/members/${A}`, undefined, groupIdFor(T))).status).toBe(204)
    expect(Object.keys(store.state.groups[groupIdFor(T)]!.members)).toEqual([A])
  })

  it('answers errors with a code', async () => {
    await start()
    const bad = await json('POST', '/members/short')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'bad_member' })
    const unknown = await json('GET', `/messages?member=${A}`)
    expect(unknown.status).toBe(404)
    expect((await json('POST', '/messages', 'nope')).status).toBe(400)
  })

  it('rate-limits requests and group creation per client', async () => {
    await start({ requestsPerMinute: 4, groupsPerHour: 2 })
    expect((await json('POST', `/members/${A}`, undefined, 'x'.repeat(43))).status).toBe(200)
    expect((await json('POST', `/members/${A}`, undefined, 'y'.repeat(43))).status).toBe(200)
    expect(await (await json('POST', `/members/${A}`, undefined, 'z'.repeat(43))).json()).toEqual({ error: 'rate_limited' })
    // Heartbeats to an existing group are not group creations.
    expect((await json('POST', `/members/${B}`, undefined, 'x'.repeat(43))).status).toBe(200)
    expect((await json('GET', '/health')).status).toBe(429)
  })
})

describe('RateLimiter', () => {
  it('resets after its window', () => {
    const c = clock()
    const limiter = new RateLimiter(1, 1000, c.now)
    expect(limiter.take('ip')).toBe(true)
    expect(limiter.take('ip')).toBe(false)
    expect(limiter.take('other')).toBe(true)
    c.t += 1000
    expect(limiter.take('ip')).toBe(true)
  })
})
