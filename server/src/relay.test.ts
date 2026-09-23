import type { INestApplication } from '@nestjs/common'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { groupIdFor } from './auth.ts'
import type { RelayOptions } from './options.ts'
import { RateLimiter } from './rate-limit.ts'
import { PREFIX } from './sync.controller.ts'
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

  it('nudges the recipients of a message and the members a newcomer joins', () => {
    const store = new SyncStore()
    const nudges: unknown[] = []
    store.onNudge = (g, members, nudge) => nudges.push([g, members, nudge])
    store.join(G, A)
    store.join(G, B)
    store.join(G, B) // heartbeat: no nudge
    store.join(G, C)
    store.post(G, A, 'x', [C])
    expect(nudges).toEqual([
      [G, [A], 'member'],
      [G, [A, B], 'member'],
      [G, [C], 'message'],
    ])
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
  let app: INestApplication
  let base = ''
  let store: SyncStore
  const T = 't'.repeat(43)

  const KEY = 'k'.repeat(32)

  async function start(options?: Partial<RelayOptions>) {
    store = new SyncStore()
    app = await createApp({ apiKey: KEY, ...options }, store)
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1') + PREFIX
  }
  afterEach(() => app.close())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = any
  const json = async (method: string, path: string, body?: unknown, token: string | null = T, key: string | null = KEY) => {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (key) headers['X-Api-Key'] = key
    const res = await fetch(base + path, {
      method,
      headers,
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

  it('refuses every route but the liveness probe without the API key', async () => {
    await start()
    for (const key of [null, 'wrong'.repeat(8), KEY.slice(1)]) {
      const res = await json('POST', `/members/${A}`, undefined, T, key)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'bad_api_key' })
      expect((await json('GET', '/health', undefined, null, key)).status).toBe(401)
    }
    expect(store.stats().groups).toBe(0)
    expect(await (await json('GET', '/healthz', undefined, null, null)).json()).toEqual({ ok: true })
    expect((await json('GET', '/health', undefined, null)).status).toBe(200)
  })

  it('refuses to start with a short API key', async () => {
    await expect(createApp({ apiKey: 'short' })).rejects.toThrow('API_KEY')
  })

  it('answers CORS preflights without the API key', async () => {
    await start()
    const res = await fetch(`${base}/messages`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://other.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-api-key,authorization' },
    })
    expect(res.status).toBeLessThan(300)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://other.example')
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-api-key')
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
