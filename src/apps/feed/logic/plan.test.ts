import { describe, expect, it } from 'vitest'
import { computeFeedPlan } from './plan'
import { learnRhythm, rhythmBounds } from './rhythm'
import { ageIntervalMin, isNightTime, resolveBaseInterval } from './intervals'
import { DEFAULT_FEED_SETTINGS, type FeedEntry, type FeedSettings } from './types'

const MIN = 60_000
const T0 = new Date(2026, 8, 22, 8, 0).getTime()

function settings(patch: Partial<FeedSettings> = {}): FeedSettings {
  return structuredClone({ ...DEFAULT_FEED_SETTINGS, ...patch })
}

function feed(at: number, baseMin = 150, i = 0): FeedEntry {
  return { id: `f${i}-${at}`, at, source: 'app', createdAt: at, updatedAt: at, plan: { baseMin, offsetMin: 0 } }
}

/** Feeds every `gaps[i]` minutes starting at T0. */
function series(gaps: number[], baseMin = 150): FeedEntry[] {
  const out = [feed(T0, baseMin, 0)]
  gaps.forEach((g, i) => out.push(feed(out[out.length - 1].at + g * MIN, baseMin, i + 1)))
  return out
}

describe('intervals', () => {
  it('follows the age table', () => {
    expect(ageIntervalMin(0)).toBe(150)
    expect(ageIntervalMin(13)).toBe(150)
    expect(ageIntervalMin(14)).toBe(180)
    expect(ageIntervalMin(70)).toBe(210)
    expect(ageIntervalMin(400)).toBe(240)
  })

  it('caps at 2h with jaundice, also in manual mode', () => {
    const s = settings({ jaundice: { active: true, since: T0 } })
    expect(resolveBaseInterval(s, 20)).toMatchObject({ baseMin: 120, jaundiceCapped: true })
    const manual = settings({ intervalMode: 'manual', manualIntervalMin: 200, jaundice: { active: true, since: T0 } })
    expect(resolveBaseInterval(manual, 20).baseMin).toBe(120)
    expect(resolveBaseInterval(settings({ intervalMode: 'manual', manualIntervalMin: 200 }), 5).baseMin).toBe(200)
  })
})

describe('rhythm learning', () => {
  it('needs at least three samples', () => {
    const feeds = series([180, 180])
    const r = learnRhythm(feeds, settings(), 150, feeds[2].at)
    expect(r.state).toBe('learning')
    expect(r.offsetMin).toBe(0)
  })

  it('learns a consistent late offset (the "120 +30" case)', () => {
    const feeds = series([150, 150, 150, 150], 120)
    const r = learnRhythm(feeds, settings(), 120, feeds[4].at)
    expect(r.state).toBe('active')
    expect(r.offsetMin).toBe(30)
  })

  it('ignores long gaps (unlogged night feeds) and cluster feeds', () => {
    const feeds = series([165, 400, 40, 165, 165], 150)
    const r = learnRhythm(feeds, settings(), 150, feeds[5].at)
    expect(r.samples.filter((s) => s.excluded === 'gap')).toHaveLength(1)
    expect(r.samples.filter((s) => s.excluded === 'cluster')).toHaveLength(1)
    expect(r.offsetMin).toBe(15)
  })

  it('clamps the offset so it cannot drift', () => {
    expect(rhythmBounds(150, false)).toEqual({ min: -30, max: 40 })
    const feeds = series([250, 250, 250, 250], 150)
    expect(learnRhythm(feeds, settings(), 150, feeds[4].at).offsetMin).toBe(40)
  })

  it('never lengthens the interval with jaundice', () => {
    const s = settings({ jaundice: { active: true, since: T0 } })
    const feeds = series([150, 150, 150, 150], 120)
    expect(learnRhythm(feeds, s, 120, feeds[4].at).offsetMin).toBe(0)
    const early = series([100, 100, 100, 100], 120)
    expect(learnRhythm(early, s, 120, early[4].at).offsetMin).toBe(-20)
  })

  it('respects reset and the disabled switch', () => {
    const feeds = series([180, 180, 180, 180])
    expect(learnRhythm(feeds, settings({ rhythm: { enabled: false, resetAt: null } }), 150, feeds[4].at).state).toBe(
      'disabled',
    )
    const reset = settings({ rhythm: { enabled: true, resetAt: feeds[2].at } })
    expect(learnRhythm(feeds, reset, 150, feeds[4].at).usedCount).toBe(2)
  })
})

describe('feed plan', () => {
  it('is empty without feeds', () => {
    const p = computeFeedPlan({ feeds: [], settings: settings(), ageDays: 3, now: T0 })
    expect(p.status).toBe('empty')
    expect(p.notifications).toHaveLength(0)
  })

  it('plans two due reminders when there is no rhythm offset', () => {
    const feeds = [feed(T0)]
    const p = computeFeedPlan({ feeds, settings: settings(), ageDays: 3, now: T0 + 10 * MIN })
    expect(p.status).toBe('ok')
    expect(p.notifications.map((n) => [n.kind, (n.at - T0) / MIN])).toEqual([
      ['due', 150],
      ['due', 300],
    ])
  })

  it('adds an age-based reminder before the rhythm reminder', () => {
    const feeds = series([150, 150, 150, 150], 120)
    const last = feeds[feeds.length - 1].at
    const p = computeFeedPlan({ feeds, settings: settings({ intervalMode: 'manual', manualIntervalMin: 120 }), ageDays: 3, now: last })
    expect(p.offsetMin).toBe(30)
    expect(p.notifications.map((n) => [n.kind, (n.at - last) / MIN])).toEqual([
      ['base', 120],
      ['due', 150],
      ['base', 270],
      ['due', 300],
    ])
    const noBase = computeFeedPlan({
      feeds,
      settings: settings({ intervalMode: 'manual', manualIntervalMin: 120, notifyAtBase: false }),
      ageDays: 3,
      now: last,
    })
    expect(noBase.notifications.map((n) => n.kind)).toEqual(['due', 'due'])
  })

  it('walks through soon → due → overdue → paused', () => {
    const feeds = [feed(T0)]
    const at = (min: number) => computeFeedPlan({ feeds, settings: settings(), ageDays: 3, now: T0 + min * MIN }).status
    expect(at(100)).toBe('ok')
    expect(at(140)).toBe('soon')
    expect(at(150)).toBe('due')
    expect(at(185)).toBe('overdue')
    expect(at(329)).toBe('overdue')
    expect(at(330)).toBe('paused')
  })

  it('stops reminding after the configured number of unanswered cycles', () => {
    const feeds = [feed(T0)]
    const p = computeFeedPlan({ feeds, settings: settings({ maxUnconfirmed: 3 }), ageDays: 3, now: T0 })
    expect(p.notifications).toHaveLength(3)
    const off = computeFeedPlan({ feeds, settings: settings({ maxUnconfirmed: 0 }), ageDays: 3, now: T0 + 999 * MIN })
    expect(off.notifications).toHaveLength(0)
    expect(off.status).toBe('overdue')
  })

  it('re-arms reminders when the last feed time is edited', () => {
    const a = computeFeedPlan({ feeds: [feed(T0)], settings: settings(), ageDays: 3, now: T0 })
    const moved = { ...feed(T0), at: T0 + 20 * MIN }
    const b = computeFeedPlan({ feeds: [moved], settings: settings(), ageDays: 3, now: T0 })
    expect(a.notifications[0].id).not.toBe(b.notifications[0].id)
  })
})

describe('night interval', () => {
  const night = (patch: Partial<FeedSettings['night']> = {}) =>
    settings({ night: { ...DEFAULT_FEED_SETTINGS.night, enabled: true, ...patch } })
  const at = (h: number, m = 0) => new Date(2026, 8, 22, h, m).getTime()

  it('detects windows that wrap past midnight', () => {
    expect(isNightTime(at(21, 59), 22 * 60, 6 * 60)).toBe(false)
    expect(isNightTime(at(22), 22 * 60, 6 * 60)).toBe(true)
    expect(isNightTime(at(3), 22 * 60, 6 * 60)).toBe(true)
    expect(isNightTime(at(6), 22 * 60, 6 * 60)).toBe(false)
    expect(isNightTime(at(1), 0, 5 * 60)).toBe(true)
    expect(isNightTime(at(5), 0, 5 * 60)).toBe(false)
  })

  it('stretches only cycles that start at night', () => {
    const day = computeFeedPlan({ feeds: [feed(at(14))], settings: night(), ageDays: 3, now: at(14) })
    expect(day.nightMin).toBe(0)
    expect(day.totalMin).toBe(150)

    // 21:00 +2.5h → 23:30 (day cycle), then 23:30 +2.5h +1h → 03:00 (night cycle).
    const p = computeFeedPlan({ feeds: [feed(at(21))], settings: night(), ageDays: 3, now: at(21) })
    expect(p.cycles.map((c) => [c.nightMin, (c.dueAt - at(21)) / MIN])).toEqual([
      [0, 150],
      [60, 360],
    ])

    const n = computeFeedPlan({ feeds: [feed(at(1))], settings: night({ extraMin: 90 }), ageDays: 3, now: at(1) })
    expect(n.baseMin).toBe(240)
    expect(n.nightMin).toBe(90)
    expect((n.cycles[0].dueAt - at(1)) / MIN).toBe(240)
  })

  it('is off when disabled or with jaundice', () => {
    const off = computeFeedPlan({ feeds: [feed(at(1))], settings: settings(), ageDays: 3, now: at(1) })
    expect(off.totalMin).toBe(150)
    const s = night()
    s.jaundice = { active: true, since: at(0) }
    const j = computeFeedPlan({ feeds: [feed(at(1))], settings: s, ageDays: 3, now: at(1) })
    expect(j.nightMin).toBe(0)
    expect(j.totalMin).toBe(120)
  })
})
