import { describe, expect, it } from 'vitest'
import { DAY, HOUR } from '@/core/time'
import { mergeDiaperRecords, normalizeDiaper } from '@/core/merge'
import { computeDiaperStats, dayCounts, expectedPerDay } from './stats'
import type { DiaperEntry } from './types'

const NOW = new Date(2026, 8, 24, 15, 0).getTime()
const MIDNIGHT = new Date(2026, 8, 24).getTime()

function d(id: string, at: number, kind: DiaperEntry['kind'], patch: Partial<DiaperEntry> = {}): DiaperEntry {
  return { id, at, kind, source: 'app', createdAt: at, updatedAt: at, ...patch }
}

describe('stats', () => {
  it('handles an empty log', () => {
    const s = computeDiaperStats([], NOW)
    expect(s).toMatchObject({ latest: null, lastWet: null, lastDirty: null, warnStool: null })
    expect(s.today).toMatchObject({ wet: 0, dirty: 0, total: 0, day: MIDNIGHT })
    expect(s.days).toHaveLength(7)
  })

  it('counts "both" as wet and dirty, today and over 24 h', () => {
    const entries = [
      d('y', MIDNIGHT - 2 * HOUR, 'dirty'),
      d('a', MIDNIGHT + HOUR, 'wet'),
      d('b', MIDNIGHT + 5 * HOUR, 'both'),
      d('c', MIDNIGHT + 9 * HOUR, 'dirty'),
    ]
    const s = computeDiaperStats(entries.reverse(), NOW)
    expect(s.today).toMatchObject({ wet: 2, dirty: 2, total: 3 })
    expect(s.last24h).toEqual({ wet: 2, dirty: 3, total: 4 })
    expect(s.latest?.id).toBe('c')
    expect(s.lastWet?.id).toBe('b')
    expect(s.lastDirty?.id).toBe('c')
    expect(s.days.at(-2)).toMatchObject({ dirty: 1, total: 1 })
  })

  it('flags a pale stool for two weeks', () => {
    const pale = d('p', NOW - 3 * DAY, 'dirty', { stool: 'pale' })
    expect(computeDiaperStats([pale, d('y', NOW - HOUR, 'dirty', { stool: 'yellow' })], NOW).warnStool?.id).toBe('p')
    expect(computeDiaperStats([pale], NOW + 12 * DAY).warnStool).toBeNull()
  })

  it('buckets per local day, oldest first', () => {
    const days = dayCounts([d('a', MIDNIGHT - DAY + HOUR, 'wet')], NOW, 3)
    expect(days.map((x) => x.total)).toEqual([0, 1, 0])
    expect(days[2]!.day).toBe(MIDNIGHT)
  })
})

describe('expectedPerDay', () => {
  it('follows the day-of-life rule, then levels off', () => {
    expect(expectedPerDay(0)).toEqual({ wet: 1, dirty: 1 })
    expect(expectedPerDay(2)).toEqual({ wet: 3, dirty: 2 })
    expect(expectedPerDay(4)).toEqual({ wet: 6, dirty: 3 })
    expect(expectedPerDay(41)).toEqual({ wet: 6, dirty: 3 })
    expect(expectedPerDay(42)).toEqual({ wet: 6, dirty: null })
    expect(expectedPerDay(-1)).toBeNull()
  })
})

describe('diaper merge', () => {
  it('rejects records without a known kind', () => {
    expect(normalizeDiaper({ id: 'a', at: NOW })).toBeNull()
    expect(normalizeDiaper({ id: 'a', at: NOW, kind: 'soggy' })).toBeNull()
    expect(normalizeDiaper({ id: 'a', at: NOW, kind: 'wet' })?.updatedAt).toBe(NOW)
  })

  it('unions by id, keeps the newer edit and applies tombstones', () => {
    const mine = [d('a', NOW, 'wet'), d('b', NOW + HOUR, 'dirty')]
    const theirs = [
      d('a', NOW, 'both', { updatedAt: NOW + DAY, stool: 'yellow' }),
      d('b', NOW + HOUR, 'dirty', { updatedAt: NOW + DAY, deletedAt: NOW + DAY }),
      d('c', NOW + 2 * HOUR, 'wet'),
    ]
    const { writes, stats } = mergeDiaperRecords(mine, theirs)
    expect(stats).toMatchObject({ added: 1, updated: 1, deleted: 1 })
    expect(writes.find((e) => e.id === 'a')).toMatchObject({ kind: 'both', stool: 'yellow' })
    // Idempotent.
    const merged = [...new Map([...mine, ...writes].map((e) => [e.id, e])).values()]
    expect(mergeDiaperRecords(merged, theirs).writes).toHaveLength(0)
  })
})
