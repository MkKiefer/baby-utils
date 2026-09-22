import { describe, expect, it } from 'vitest'
import { DAY } from '@/core/time'
import { mergeWeightRecords, normalizeWeight } from '@/core/merge'
import { formatChange, formatWeight, gramsFromKg, gramsFromLbOz, toLbOz } from './format'
import { birthMoment } from './repo'
import { computeWeightStats, recentRate } from './stats'
import type { WeightEntry } from './types'

const BIRTH = new Date(2026, 8, 1, 12, 0).getTime()

function w(id: string, day: number, grams: number, patch: Partial<WeightEntry> = {}): WeightEntry {
  const at = BIRTH + day * DAY
  return { id, at, grams, source: 'app', createdAt: at, updatedAt: at, ...patch }
}

describe('format', () => {
  it('shows kg with a third decimal only when it matters', () => {
    expect(formatWeight(3450, 'kg')).toBe('3.45 kg')
    expect(formatWeight(3455, 'kg')).toBe('3.455 kg')
    expect(formatWeight(3400, 'kg')).toBe('3.40 kg')
    expect(formatWeight(12_500, 'kg')).toBe('12.50 kg')
  })

  it('shows pounds and ounces, rolling 16 oz over', () => {
    expect(formatWeight(3450, 'lb')).toBe('7 lb 9.7 oz')
    expect(toLbOz(453.59237 * 8 - 0.5)).toEqual({ lb: 8, oz: 0 })
  })

  it('formats changes and rates', () => {
    expect(formatChange(120, 'kg')).toBe('+120 g')
    expect(formatChange(-85, 'kg')).toBe('−85 g')
    expect(formatChange(0, 'kg')).toBe('±0 g')
    expect(formatChange(1250, 'kg')).toBe('+1.25 kg')
    expect(formatChange(-56.7, 'lb')).toBe('−2 oz')
    expect(formatChange(31.6, 'kg')).toBe('+32 g')
  })

  it('parses kg, grams typed into the kg field and lb/oz', () => {
    expect(gramsFromKg('3,45')).toBe(3450)
    expect(gramsFromKg('3.455')).toBe(3455)
    expect(gramsFromKg('3450')).toBe(3450)
    expect(gramsFromKg('')).toBeNull()
    expect(gramsFromKg('-1')).toBeNull()
    expect(gramsFromLbOz('7', '9.7')).toBe(3450)
    expect(gramsFromLbOz('', '')).toBeNull()
  })
})

describe('birthMoment', () => {
  it('uses the birth time when there is one, else midday', () => {
    expect(birthMoment({ birthDate: '2026-09-01' })).toBe(BIRTH)
    expect(birthMoment({ birthDate: '2026-09-01', birthTime: '03:30' })).toBe(new Date(2026, 8, 1, 3, 30).getTime())
    expect(birthMoment(null)).toBeNull()
  })
})

describe('stats', () => {
  it('handles no and one entry', () => {
    expect(computeWeightStats([], BIRTH)).toMatchObject({ latest: null, change: null, rate: null, birth: null })
    const one = computeWeightStats([w('a', 0, 3500)], BIRTH)
    expect(one.latest?.id).toBe('a')
    expect(one.birth?.id).toBe('a')
    expect(one.vsBirthPct).toBeNull()
    expect(one.rate).toBeNull()
  })

  it('tracks the newborn dip and when birth weight is regained', () => {
    const entries = [w('b', 0, 3500), w('d3', 3, 3220), w('d5', 5, 3300), w('d10', 10, 3510), w('d14', 14, 3650)]
    const s = computeWeightStats(entries.reverse(), BIRTH)
    expect(s.birth?.id).toBe('b')
    expect(s.lowest?.id).toBe('d3')
    expect(s.regainedAt).toBe(BIRTH + 10 * DAY)
    expect(s.change).toBe(140)
    expect(s.vsBirthPct).toBeCloseTo((150 / 3500) * 100)
  })

  it('has no birth weight when the first weighing is long after birth', () => {
    const s = computeWeightStats([w('a', 20, 4000), w('b', 27, 4200)], BIRTH)
    expect(s.birth).toBeNull()
    expect(s.vsBirthPct).toBeNull()
    expect(s.lowest).toBeNull()
  })

  it('measures the rate over at least three days when it can', () => {
    const rate = recentRate([w('a', 0, 4000), w('b', 6, 4180), w('c', 8, 4250), w('d', 9, 4280)])
    // d vs b: 100 g over 3 days.
    expect(rate?.gramsPerDay).toBeCloseTo(100 / 3)
    expect(rate?.fromAt).toBe(BIRTH + 6 * DAY)
  })

  it('falls back to the previous weighing when the gap is longer than the window', () => {
    const rate = recentRate([w('a', 0, 4000), w('b', 30, 4900)])
    expect(rate?.gramsPerDay).toBeCloseTo(30)
  })

  it('ignores two weighings on the same morning', () => {
    expect(recentRate([w('a', 0, 4000), w('b', 0.1, 4010)])).toBeNull()
  })
})

describe('weight merge', () => {
  it('rejects records without a usable weight', () => {
    expect(normalizeWeight({ id: 'a', at: BIRTH })).toBeNull()
    expect(normalizeWeight({ id: 'a', at: BIRTH, grams: 0 })).toBeNull()
    expect(normalizeWeight({ id: 'a', at: BIRTH, grams: 3500 })?.updatedAt).toBe(BIRTH)
  })

  it('unions by id, keeps the newer edit and applies tombstones', () => {
    const mine = [w('a', 0, 3500), w('b', 3, 3300)]
    const theirs = [
      w('a', 0, 3510, { updatedAt: BIRTH + DAY }),
      w('b', 3, 3300, { updatedAt: BIRTH + 4 * DAY, deletedAt: BIRTH + 4 * DAY }),
      w('c', 5, 3400),
    ]
    const { writes, stats } = mergeWeightRecords(mine, theirs)
    expect(stats).toMatchObject({ added: 1, updated: 1, deleted: 1 })
    expect(writes.find((e) => e.id === 'a')?.grams).toBe(3510)
    // Idempotent.
    const merged = [...new Map([...mine, ...writes].map((e) => [e.id, e])).values()]
    expect(mergeWeightRecords(merged, theirs).writes).toHaveLength(0)
  })
})
