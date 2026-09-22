import { describe, expect, it } from 'vitest'
import { addMonths, ageInfo, nextMilestone } from './age'

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

describe('ageInfo', () => {
  it('uses days for the first two weeks', () => {
    expect(ageInfo('2026-09-22', on(2026, 9, 22)).primary).toBe('Born today')
    expect(ageInfo('2026-09-21', on(2026, 9, 22)).primary).toBe('1 day')
    expect(ageInfo('2026-09-09', on(2026, 9, 22)).primary).toBe('13 days')
  })

  it('switches to weeks, then months, then years', () => {
    expect(ageInfo('2026-09-08', on(2026, 9, 22)).primary).toBe('2 weeks')
    expect(ageInfo('2026-08-01', on(2026, 9, 22)).primary).toBe('7 weeks 3 days')
    expect(ageInfo('2026-06-01', on(2026, 9, 22)).primary).toBe('3 months 3 weeks')
    expect(ageInfo('2026-06-22', on(2026, 9, 22)).primary).toBe('3 months')
    expect(ageInfo('2024-07-10', on(2026, 9, 22)).primary).toBe('2 years 2 months')
  })

  it('handles month ends', () => {
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28)
    expect(ageInfo('2026-01-31', on(2026, 2, 28)).months).toBe(1)
    expect(ageInfo('2026-01-31', on(2026, 2, 27)).months).toBe(0)
  })

  it('finds the next milestone', () => {
    expect(nextMilestone('2026-09-20', on(2026, 9, 22))).toMatchObject({ label: '1 week', inDays: 5 })
    expect(nextMilestone('2026-08-22', on(2026, 9, 22))).toMatchObject({ label: '1 month', inDays: 0 })
  })
})
