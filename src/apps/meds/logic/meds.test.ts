import { describe, expect, it } from 'vitest'
import { HOUR } from '@/core/time'
import { mergeDoseRecords, mergePlanRecords, normalizeDose, normalizePlan } from '@/core/merge'
import {
  addDays,
  courseProgress,
  defaultTimes,
  dueWithFeed,
  isDoseDay,
  overdueCount,
  planDay,
  planIdFromReminder,
  plannedReminders,
  planStatus,
} from './schedule'
import { describeSchedule } from './format'
import type { MedDose, MedPlan } from './types'

const DAY0 = new Date(2026, 9, 20).getTime()
const at = (day: number, h: number, m = 0) => new Date(2026, 9, 20 + day, h, m).getTime()

function plan(patch: Partial<MedPlan> = {}): MedPlan {
  return { id: 'p', name: 'Amoxicillin', dose: '2.5 ml', at: DAY0, timesPerDay: 3, everyDays: 1, days: 5, source: 'app', createdAt: DAY0, updatedAt: DAY0, ...patch }
}

function dose(id: string, ms: number, patch: Partial<MedDose> = {}): MedDose {
  return { id, planId: 'p', at: ms, name: 'Amoxicillin', source: 'app', createdAt: ms, updatedAt: ms, ...patch }
}

describe('schedule', () => {
  it('knows dose days, status and the end of a course', () => {
    const p = plan()
    expect(isDoseDay(p, at(0, 9))).toBe(true)
    expect(isDoseDay(p, at(4, 23))).toBe(true)
    expect(isDoseDay(p, at(5, 1))).toBe(false)
    expect(isDoseDay(p, at(-1, 12))).toBe(false)
    expect(planStatus(p, at(-1, 12))).toBe('upcoming')
    expect(planStatus(p, at(2, 12))).toBe('active')
    expect(planStatus(p, at(5, 0))).toBe('finished')
    expect(planStatus({ ...p, days: undefined }, at(500, 0))).toBe('active')
    expect(planStatus({ ...p, stoppedAt: at(1, 10) }, at(1, 11))).toBe('stopped')
  })

  it('repeats every n days', () => {
    const p = plan({ everyDays: 2, days: 7 })
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => isDoseDay(p, at(d, 12)))).toEqual([true, false, true, false, true, false, true, false])
    expect(courseProgress(p, [], at(0, 12)).planned).toBe(12)
    expect(describeSchedule(p)).toBe('3× every 2nd day for 7 days (12 doses)')
  })

  it('fills slots in order and shows the next fixed time', () => {
    const p = plan({ times: ['20:00', '08:00', '14:00'] })
    const doses = [dose('a', at(1, 8, 20))]
    const d = planDay(p, doses, at(1, 12), at(1, 12))
    expect(d).toMatchObject({ doseDay: true, expected: 3, given: 1, done: false })
    expect(d.slots.map((s) => s.at)).toEqual([at(1, 8), at(1, 14), at(1, 20)])
    expect(d.slots[0]!.dose?.id).toBe('a')
    expect(d.next).toEqual({ at: at(1, 14), approx: false, overdue: false })
    expect(planDay(p, doses, at(1, 15), at(1, 15)).next?.overdue).toBe(true)
  })

  it('matches doses to the nearest time and leaves out times passed before the plan existed', () => {
    // Created at 19:30 on the first day: 08:00 and 14:00 are left out, 20:00 is due.
    const p = plan({ times: ['08:00', '14:00', '20:00'], createdAt: at(0, 19, 30) })
    const first = planDay(p, [], at(0, 19, 45), at(0, 19, 45))
    expect(first.slots.map((s) => s.at)).toEqual([at(0, 20)])
    expect(first.next).toMatchObject({ at: at(0, 20), overdue: false })
    const given = planDay(p, [dose('a', at(0, 20, 13))], at(0, 21), at(0, 21))
    expect(given).toMatchObject({ expected: 1, given: 1, done: true })
    expect(courseProgress(p, [dose('a', at(0, 20, 13))], at(0, 21)).planned).toBe(13)

    // Next day: an evening dose without the midday one marks midday as missed, not overdue.
    const day1 = planDay(p, [dose('b', at(1, 8)), dose('c', at(1, 19, 50))], at(1, 21), at(1, 21))
    expect(day1.slots.map((s) => [s.dose?.id ?? null, s.missed])).toEqual([['b', false], [null, true], ['c', false]])
    expect(day1).toMatchObject({ missed: 1, done: true, next: null })
    expect(plannedReminders([{ ...p, remind: true }], [dose('b', at(1, 8)), dose('c', at(1, 19, 50))], at(1, 21)).map((n) => n.at)[0]).toBe(at(2, 8))
  })

  it('suggests a gap without fixed times and counts skips as handled', () => {
    const p = plan()
    const doses = [dose('a', at(0, 7)), dose('b', at(0, 15), { skipped: true })]
    const d = planDay(p, doses, at(0, 16), at(0, 16))
    expect(d).toMatchObject({ given: 1, skipped: 1, done: false })
    expect(d.next).toMatchObject({ at: at(0, 23), approx: true })
    const all = [...doses, dose('c', at(0, 22))]
    expect(planDay(p, all, at(0, 23), at(0, 23))).toMatchObject({ done: true, next: null })
    expect(courseProgress(p, all, at(0, 23))).toEqual({ dayNumber: 1, totalDays: 5, given: 2, skipped: 1, planned: 15 })
  })

  it('stopping a plan shortens the course', () => {
    const p = plan({ stoppedAt: at(2, 9) })
    const doses = [dose('a', at(2, 8))]
    // Two full days before the stop, plus the one dose on the stop day.
    expect(courseProgress(p, doses, at(3, 9)).planned).toBe(7)
    expect(planDay(p, doses, at(3, 9), at(3, 9)).doseDay).toBe(false)
  })

  it('treats as-needed plans as a daily maximum', () => {
    const p = plan({ asNeeded: true, timesPerDay: 2, days: undefined })
    const d = planDay(p, [dose('a', at(0, 9)), dose('b', at(0, 12))], at(0, 13), at(0, 13))
    expect(d).toMatchObject({ expected: 2, given: 2, next: null })
    expect(courseProgress(p, [], at(0, 13)).planned).toBeNull()
    expect(describeSchedule(p)).toBe('As needed, up to 2× a day')
  })

  it('spreads default times over the day', () => {
    expect(defaultTimes(3)).toEqual(['08:00', '14:00', '20:00'])
    expect(defaultTimes(6)).toEqual(['02:00', '06:00', '10:00', '14:00', '18:00', '22:00'])
    expect(addDays(DAY0, 3)).toBe(at(3, 0))
  })
})

describe('with a feed', () => {
  const p = plan({ withFeed: true, times: ['08:00', '14:00', '20:00'] })
  const morning = [dose('a', at(1, 8, 10))]

  it('shows the dose that belongs to the coming feed', () => {
    const feed = (h: number, m = 0) => ({ dueAt: at(1, h, m), intervalMs: 3 * HOUR })
    // 14:00 is closer to a 13:30 feed than to the one after (16:30).
    expect(dueWithFeed([p], morning, at(1, 11), feed(13, 30)).map((d) => d.today.next!.at)).toEqual([at(1, 14)])
    // A feed at 11:30 is followed by one at 14:30, which is the better match.
    expect(dueWithFeed([p], morning, at(1, 11), feed(11, 30))).toEqual([])
    // Not given yet: still shown once overdue.
    expect(dueWithFeed([p], [], at(1, 11), feed(11, 30))).toHaveLength(1)
    // Without a planned feed: due within the next 90 minutes.
    expect(dueWithFeed([p], morning, at(1, 12, 45), null)).toHaveLength(1)
    expect(dueWithFeed([p], morning, at(1, 12), null)).toEqual([])
  })

  it('ignores other plans and finished days', () => {
    const now = at(1, 13)
    const feed = { dueAt: at(1, 14), intervalMs: 3 * HOUR }
    expect(dueWithFeed([{ ...p, withFeed: undefined }], morning, now, feed)).toEqual([])
    expect(dueWithFeed([{ ...p, asNeeded: true }], [], now, feed)).toEqual([])
    expect(dueWithFeed([p], morning, at(9, 13), feed)).toEqual([])
    const allGiven = [...morning, dose('b', at(1, 14)), dose('c', at(1, 20))]
    expect(dueWithFeed([p], allGiven, at(1, 21), { dueAt: at(1, 22), intervalMs: 3 * HOUR })).toEqual([])
  })

  it('without fixed times, offers the first dose of the day', () => {
    expect(dueWithFeed([plan({ withFeed: true, timesPerDay: 1 })], [], at(1, 6), null)).toHaveLength(1)
  })
})

describe('reminders', () => {
  it('plans open fixed-time slots today and tomorrow, only when asked', () => {
    const p = plan({ times: ['08:00', '14:00', '20:00'], remind: true })
    const doses = [dose('a', at(1, 8, 5))]
    const r = plannedReminders([p], doses, at(1, 9))
    expect(r.map((n) => n.at)).toEqual([at(1, 14), at(1, 20), at(2, 8), at(2, 14), at(2, 20)])
    expect(r[0]).toMatchObject({ id: 'med:p:2026-10-21:1', tag: 'med:p', title: 'Amoxicillin is due' })
    expect(planIdFromReminder(r[0]!.id)).toBe('p')
    expect(plannedReminders([{ ...p, remind: false }], doses, at(1, 9))).toEqual([])
    // Last day of the course: today's open slots only, nothing for the day after.
    expect(plannedReminders([p], [], at(4, 21)).map((n) => n.at)).toEqual([at(4, 8), at(4, 14), at(4, 20)])
    expect(overdueCount([p], doses, at(1, 15))).toBe(1)
  })
})

describe('medication merge', () => {
  it('rejects malformed records', () => {
    expect(normalizePlan({ id: 'p', name: 'X', at: DAY0 })).toBeNull()
    expect(normalizePlan({ id: 'p', name: 'X', at: DAY0, timesPerDay: 0 })).toBeNull()
    expect(normalizePlan({ id: 'p', name: 'X', at: DAY0, timesPerDay: 2 })).toMatchObject({ everyDays: 1, updatedAt: DAY0 })
    expect(normalizeDose({ id: 'd', at: DAY0 })).toBeNull()
    expect(normalizeDose({ id: 'd', planId: 'p', at: DAY0 })?.name).toBe('Medication')
  })

  it('unions by id, keeps the newer edit and applies tombstones', () => {
    const mine = [plan()]
    const theirs = [plan({ name: 'Amoxi', updatedAt: DAY0 + HOUR }), plan({ id: 'q', name: 'Vitamin D' })]
    const plans = mergePlanRecords(mine, theirs)
    expect(plans.stats).toMatchObject({ added: 1, updated: 1 })
    expect(plans.writes.find((p) => p.id === 'p')?.name).toBe('Amoxi')

    const doses = mergeDoseRecords([dose('a', at(0, 8))], [dose('a', at(0, 8), { updatedAt: at(0, 9), deletedAt: at(0, 9) })])
    expect(doses.stats.deleted).toBe(1)
  })
})
