import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../db'
import { PROFILE_KEY } from '../profile'
import { decide, processDue, STALE_MS } from './engine'
import type { PlannedNotification } from './types'

const MIN = 60_000
const T0 = Date.UTC(2026, 8, 22, 6, 0)

function planned(id: string, at: number, tag = 'feed'): PlannedNotification {
  return { id, at, tag, title: id, body: '', source: 'feed', kind: 'due', url: '/' }
}

describe('decide', () => {
  it('only shows the newest reminder per tag', () => {
    const d = decide([planned('a', T0), planned('b', T0 + MIN)], T0 + MIN, false)
    expect(d.map((x) => [x.n.id, x.show, x.reason])).toEqual([
      ['a', false, 'superseded'],
      ['b', true, undefined],
    ])
  })

  it('skips late reminders while the app is on screen, and stale ones always', () => {
    expect(decide([planned('a', T0)], T0 + 5 * MIN, true)[0].reason).toBe('app-visible')
    expect(decide([planned('a', T0)], T0 + 5 * MIN, false)[0].show).toBe(true)
    expect(decide([planned('a', T0)], T0 + STALE_MS + MIN, false)[0].reason).toBe('stale')
  })
})

describe('processDue', () => {
  beforeEach(async () => {
    const db = await getDB()
    await Promise.all([db.clear('feeds'), db.clear('kv'), db.clear('notifLog')])
    await db.put('kv', { name: 'Test', birthDate: '2026-09-20', createdAt: T0 }, PROFILE_KEY)
    await db.put('feeds', { id: 'f1', at: T0, source: 'app', createdAt: T0, plan: { baseMin: 150, offsetMin: 0 } })
  })

  const opts = (show = vi.fn(async () => {})) => ({ via: 'page' as const, appVisible: false, canNotify: true, show })

  it('shows a due reminder exactly once, even across contexts', async () => {
    const db = await getDB()
    const show = vi.fn(async () => {})
    const at = T0 + 150 * MIN + 10_000
    const [a, b] = await Promise.all([processDue(db, at, opts(show)), processDue(db, at, { ...opts(show), via: 'sw' })])
    expect(show).toHaveBeenCalledTimes(1)
    expect([...a.shown, ...b.shown]).toHaveLength(1)
    const again = await processDue(db, at + 1000, opts(show))
    expect(again.shown).toHaveLength(0)
    expect(show).toHaveBeenCalledTimes(1)
    const log = await db.getAll('notifLog')
    expect(log[0]).toMatchObject({ status: 'shown', kind: 'due' })
  })

  it('points to the next reminder and goes quiet after two unanswered cycles', async () => {
    const db = await getDB()
    const first = await processDue(db, T0 + 10 * MIN, opts())
    expect(first.next?.at).toBe(T0 + 150 * MIN)
    await processDue(db, T0 + 150 * MIN, opts())
    const second = await processDue(db, T0 + 300 * MIN, opts())
    expect(second.shown).toHaveLength(1)
    expect(second.next).toBeNull()
    expect(second.plan.badge).toBe(1)
  })

  it('logs but does not show without permission', async () => {
    const db = await getDB()
    const show = vi.fn(async () => {})
    const res = await processDue(db, T0 + 151 * MIN, { ...opts(show), canNotify: false })
    expect(show).not.toHaveBeenCalled()
    expect(res.skipped).toHaveLength(1)
    expect((await db.getAll('notifLog'))[0].reason).toBe('no-permission')
  })
})
