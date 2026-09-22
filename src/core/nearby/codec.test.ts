import { describe, expect, it } from 'vitest'
import { FrameCollector, fromTuple, packPayload, toFrames, toTuple, unpackPayload } from './codec'
import { selectForSync } from './sync'
import { mergeFeedRecords, normalizeEntry } from '../merge'
import type { FeedEntry } from '@/apps/feed/logic/types'

const T0 = new Date(2026, 8, 22, 8, 0).getTime()
const MIN = 60_000

function feed(id: string, patch: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id,
    at: T0,
    source: 'app',
    createdAt: T0 + 7,
    updatedAt: T0 + 7,
    plan: { baseMin: 150, offsetMin: -12 },
    ...patch,
  }
}

const sample: FeedEntry[] = [
  feed('3f1c2a9e-0000-4000-8000-000000000001'),
  feed('3f1c2a9e-0000-4000-8000-000000000002', { kind: 'left', note: 'sleepy: 10 min', updatedAt: T0 + 3 * MIN + 1 }),
  feed('3f1c2a9e-0000-4000-8000-000000000003', { kind: 'bottle', source: 'notification', deletedAt: T0 + 9 * MIN, updatedAt: T0 + 9 * MIN }),
  feed('3f1c2a9e-0000-4000-8000-000000000004', { kind: 'right', source: 'import', deletedAt: T0 + MIN, updatedAt: T0 + MIN }),
]

describe('tuples', () => {
  it('round-trip every field exactly, to the millisecond', () => {
    for (const e of sample) expect(normalizeEntry(fromTuple(toTuple(e)))).toEqual(e)
  })

  it('reject garbage', () => {
    expect(fromTuple(null)).toBeNull()
    expect(fromTuple({ id: 'x' })).toBeNull()
    expect(fromTuple([1, 2])).toBeNull()
  })
})

describe('packPayload', () => {
  it.each([true, false])('round-trips (compressed: %s)', async (compress) => {
    const text = await packPayload({ v: 1, sentAt: T0, since: T0 - MIN, feeds: sample }, compress)
    expect(text).toMatch(/^[zj][A-Za-z0-9_-]+$/)
    const back = await unpackPayload(text)
    expect(back.sentAt).toBe(T0)
    expect(back.since).toBe(T0 - MIN)
    expect(back.records.map(normalizeEntry)).toEqual(sample)
  })

  it('is small enough for a year of feeds to stay practical', async () => {
    const year = Array.from({ length: 3650 }, (_, i) =>
      feed(crypto.randomUUID(), { at: T0 + i * 150 * MIN, createdAt: T0 + i * 150 * MIN + 3, updatedAt: T0 + i * 150 * MIN + 3, kind: 'left' }),
    )
    const text = await packPayload({ v: 1, sentAt: T0, since: null, feeds: year })
    // ~40 bytes per feed after deflate: a random UUID alone is 16 bytes of entropy.
    expect(text.length / year.length).toBeLessThan(60)
  })

  it('rejects unknown formats', async () => {
    await expect(unpackPayload('xabc')).rejects.toThrow()
  })
})

describe('frames', () => {
  it('reassemble in any order, ignoring repeats and foreign codes', () => {
    const data = 'z' + 'A'.repeat(1000) + 'b_-'
    const frames = toFrames(data, 'abc123', 100)
    expect(frames).toHaveLength(11)
    const c = new FrameCollector()
    expect(c.add('https://example.com')).toBeNull()
    let last = null
    for (const f of [...frames.slice(5), frames[0], frames[0], ...frames.slice(0, 5)]) last = c.add(f)
    expect(last).toEqual({ received: 11, total: 11, data })
  })

  it('start over when the other phone restarts with a new session', () => {
    const c = new FrameCollector()
    c.add(toFrames('aaaa', 's1', 2)[0])
    const p = c.add(toFrames('bbbb', 's2', 2)[1])
    expect(p).toEqual({ received: 1, total: 2, data: null })
  })

  it('carry a single small payload in one code', () => {
    expect(toFrames('zabc', 's')).toEqual(['BU1:s:0:1:zabc'])
  })
})

describe('selectForSync', () => {
  it('includes edits and tombstones after the cut-off, and nothing older', () => {
    const since = T0 + 2 * MIN
    expect(selectForSync(sample, since).map((e) => e.id.slice(-1))).toEqual(['2', '3'])
    expect(selectForSync(sample, null)).toHaveLength(4)
  })
})

describe('end to end', () => {
  it('two phones converge after scanning each other', async () => {
    const a = [sample[0], sample[1]]
    const b = [sample[2], feed(sample[0].id, { note: 'edited on B', updatedAt: T0 + 20 * MIN })]
    const apply = (local: FeedEntry[], incoming: unknown[]) => {
      const byId = new Map(local.map((e) => [e.id, e]))
      for (const w of mergeFeedRecords(local, incoming).writes) byId.set(w.id, w)
      return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id))
    }
    const send = async (feeds: FeedEntry[]) => {
      const c = new FrameCollector()
      let data: string | null = null
      for (const f of toFrames(await packPayload({ v: 1, sentAt: T0, since: null, feeds }), 's', 40)) data = c.add(f)?.data ?? data
      return (await unpackPayload(data!)).records
    }
    const b2 = apply(b, await send(a))
    const a2 = apply(a, await send(b2))
    expect(a2).toEqual(b2)
    expect(a2.find((e) => e.id === sample[0].id)?.note).toBe('edited on B')
  })
})
