import { DAY, HOUR, MINUTE, startOfDay } from '@/core/time'
import type { PlannedNotification } from '@/core/notify/types'
import { MED_GIVEN_ACTION, type MedDose, type MedPlan } from './types'

/**
 * Pure schedule maths for medication plans. DOM/Vue free (the service worker plans
 * reminders with it).
 *
 * Doses belong to the local day they were given on. With fixed times each dose fills the
 * nearest free slot, so a late morning dose still counts as the morning one; a free slot
 * earlier than the last dose was missed and is not due any more. Slots that had already
 * passed when the plan was created are left out. Without fixed times the nth dose fills
 * the nth slot.
 */

/** A dose this late past its fixed time is shown as overdue. */
export const OVERDUE_MS = 30 * MINUTE
/** On the first day, fixed times this long before the plan was created are left out. */
export const LATE_START_MS = 2 * HOUR

/** `day` (local midnight) plus `n` calendar days, DST-safe. */
export function addDays(day: number, n: number): number {
  const d = new Date(day)
  d.setDate(d.getDate() + n)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Calendar days from the plan's first day to the day containing `ms` (0 = first day). */
export function dayIndex(plan: Pick<MedPlan, 'at'>, ms: number): number {
  return Math.round((startOfDay(ms) - startOfDay(plan.at)) / DAY)
}

/** "2026-10-25" for the local day containing `ms`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "08:30" → 510; null when malformed. */
export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

export function formatTime(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
}

/** The clock time `time` ("HH:MM") on local day `day`. */
export function slotTime(day: number, time: string): number {
  const minutes = parseTime(time) ?? 0
  const d = new Date(day)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d.getTime()
}

/** Sensible waking-hours times for n doses a day. */
export function defaultTimes(n: number): string[] {
  const table: Record<number, string[]> = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '14:00', '20:00'],
    4: ['07:00', '12:00', '17:00', '22:00'],
  }
  if (table[n]) return table[n]
  const step = (24 * 60) / n
  return Array.from({ length: n }, (_, i) => Math.round((6 * 60 + i * step) / 5) * 5 % (24 * 60))
    .sort((a, b) => a - b)
    .map(formatTime)
}

/** Fixed times sorted, or null when the plan has none (or they do not match the count). */
export function planTimes(plan: MedPlan): string[] | null {
  if (plan.asNeeded || !plan.times?.length || plan.times.length !== plan.timesPerDay) return null
  if (plan.times.some((t) => parseTime(t) === null)) return null
  return [...plan.times].sort((a, b) => parseTime(a)! - parseTime(b)!)
}

/** Last planned day (local midnight), or null for an ongoing plan. */
export function lastDay(plan: MedPlan): number | null {
  const byLength = plan.days ? addDays(startOfDay(plan.at), plan.days - 1) : null
  const byStop = plan.stoppedAt !== undefined ? startOfDay(plan.stoppedAt) : null
  if (byLength === null) return byStop
  return byStop === null ? byLength : Math.min(byLength, byStop)
}

/** Whether doses are planned on the local day containing `ms`. */
export function isDoseDay(plan: MedPlan, ms: number): boolean {
  const idx = dayIndex(plan, ms)
  if (idx < 0 || idx % Math.max(1, plan.everyDays) !== 0) return false
  const last = lastDay(plan)
  return last === null || startOfDay(ms) <= last
}

export type PlanStatus = 'upcoming' | 'active' | 'finished' | 'stopped'

export function planStatus(plan: MedPlan, now: number): PlanStatus {
  if (plan.stoppedAt !== undefined && plan.stoppedAt <= now) return 'stopped'
  if (startOfDay(now) < startOfDay(plan.at)) return 'upcoming'
  const last = lastDay(plan)
  if (last !== null && startOfDay(now) > last) return 'finished'
  return 'active'
}

/** Number of dose days in a fixed-length course; null if ongoing. */
export function doseDayCount(plan: MedPlan): number | null {
  return plan.days ? Math.ceil(plan.days / Math.max(1, plan.everyDays)) : null
}

export interface Slot {
  /** Planned time, only with fixed times. */
  at: number | null
  /** The dose that filled this slot. */
  dose: MedDose | null
  /** Free, but a later dose was already given: not due any more. */
  missed: boolean
}

export interface PlanDay {
  day: number
  doseDay: boolean
  /** Planned doses (the maximum, for as-needed plans). */
  expected: number
  given: number
  skipped: number
  /** Free slots passed over by a later dose. */
  missed: number
  slots: Slot[]
  /** Doses of this plan on this day, oldest first. */
  doses: MedDose[]
  /** Next dose; `approx` when there are no fixed times and it is only a suggested gap. */
  next: { at: number; approx: boolean; overdue: boolean } | null
  /** Nothing is due any more today (every slot given, skipped or missed). */
  done: boolean
}

/** Fixed-time slots of a day: assigned to doses by nearest time, missed ones marked. */
function fixedSlots(plan: MedPlan, times: string[], day: number, mine: MedDose[]): Slot[] {
  let slots: Slot[] = times.map((t) => ({ at: slotTime(day, t), dose: null, missed: false }))
  for (const dose of mine) {
    let best: Slot | null = null
    for (const s of slots) {
      if (s.dose) continue
      if (!best || Math.abs(dose.at - s.at!) < Math.abs(dose.at - best.at!)) best = s
    }
    if (best) best.dose = dose
  }
  if (day === startOfDay(plan.at)) slots = slots.filter((s) => s.dose || s.at! >= plan.createdAt - LATE_START_MS)
  const lastGiven = mine.at(-1)?.at ?? -Infinity
  for (const s of slots) s.missed = !s.dose && s.at! < lastGiven
  return slots
}

/** Fixed-time slots left out on the first day because they had passed at creation. */
export function droppedOnStart(plan: MedPlan, doses: MedDose[]): number {
  const times = planTimes(plan)
  if (!times) return 0
  const day = startOfDay(plan.at)
  if (!isDoseDay(plan, day)) return 0
  return times.length - fixedSlots(plan, times, day, dosesOn(plan.id, doses, day)).length
}

function dosesOn(planId: string, doses: MedDose[], day: number): MedDose[] {
  const end = addDays(day, 1)
  return doses.filter((d) => d.planId === planId && d.at >= day && d.at < end).sort((a, b) => a.at - b.at)
}

/** How the plan stands on the local day containing `ms`, as seen at `now`. */
export function planDay(plan: MedPlan, doses: MedDose[], ms: number, now: number): PlanDay {
  const day = startOfDay(ms)
  const mine = dosesOn(plan.id, doses, day)
  const stopped = plan.stoppedAt !== undefined && plan.stoppedAt <= now
  const doseDay = isDoseDay(plan, day) && !(stopped && day > startOfDay(plan.stoppedAt!))
  const given = mine.filter((d) => !d.skipped).length
  const skipped = mine.length - given
  const times = planTimes(plan)
  const slots: Slot[] = !doseDay
    ? []
    : times
      ? fixedSlots(plan, times, day, mine)
      : Array.from({ length: plan.timesPerDay }, (_, i) => ({ at: null, dose: mine[i] ?? null, missed: false }))
  const expected = slots.length
  const missed = slots.filter((s) => s.missed).length
  const open = slots.filter((s) => !s.dose && !s.missed)
  const done = doseDay && open.length === 0

  let next: PlanDay['next'] = null
  if (doseDay && !done && !plan.asNeeded && !stopped) {
    if (times) {
      const at = open[0]!.at!
      next = { at, approx: false, overdue: now > at + OVERDUE_MS }
    } else {
      const last = mine.at(-1)
      const at = last ? last.at + (24 * HOUR) / plan.timesPerDay : Math.max(day, Math.min(now, addDays(day, 1) - 1))
      next = { at, approx: true, overdue: false }
    }
  }
  return { day, doseDay, expected, given, skipped, missed, slots, doses: mine, next, done }
}

export interface Course {
  /** 1-based day of the course for `now`, or null before it starts. */
  dayNumber: number | null
  /** Calendar length of the course; null if ongoing. */
  totalDays: number | null
  given: number
  skipped: number
  /** All planned doses over the course; null if ongoing or as needed. */
  planned: number | null
}

export function courseProgress(plan: MedPlan, doses: MedDose[], now: number): Course {
  const mine = doses.filter((d) => d.planId === plan.id)
  const given = mine.filter((d) => !d.skipped).length
  const idx = dayIndex(plan, now)
  let planned: number | null = null
  const count = doseDayCount(plan)
  if (count !== null && !plan.asNeeded) {
    if (plan.stoppedAt !== undefined) {
      // Days before the stop, plus whatever was handled on the stop day itself.
      const stopDay = startOfDay(plan.stoppedAt)
      const before = Math.min(count, Math.ceil(Math.max(0, dayIndex(plan, stopDay)) / Math.max(1, plan.everyDays)))
      const onStopDay = isDoseDay({ ...plan, stoppedAt: undefined }, stopDay)
        ? Math.min(plan.timesPerDay, dosesOn(plan.id, mine, stopDay).length)
        : 0
      planned = before * plan.timesPerDay + onStopDay
    } else {
      planned = count * plan.timesPerDay
    }
    planned -= droppedOnStart(plan, mine)
  }
  return {
    dayNumber: idx >= 0 ? idx + 1 : null,
    totalDays: plan.days ?? null,
    given,
    skipped: mine.length - given,
    planned,
  }
}

export function sortPlans(plans: MedPlan[]): MedPlan[] {
  return [...plans].sort((a, b) => a.at - b.at || a.createdAt - b.createdAt)
}

export function sortDoses(doses: MedDose[]): MedDose[] {
  return [...doses].sort((a, b) => a.at - b.at)
}

/**
 * Reminders for plans with fixed times and reminders on: one per open slot today and
 * tomorrow. Ids are stable per plan, day and slot, so the notification log dedupes them.
 */
export function plannedReminders(plans: MedPlan[], doses: MedDose[], now: number): PlannedNotification[] {
  const out: PlannedNotification[] = []
  const today = startOfDay(now)
  for (const plan of plans) {
    if (plan.deletedAt || !plan.remind || !planTimes(plan)) continue
    for (const day of [today, addDays(today, 1)]) {
      const pd = planDay(plan, doses, day, now)
      pd.slots.forEach((slot, i) => {
        if (slot.dose || slot.missed || slot.at === null) return
        out.push({
          id: `med:${plan.id}:${dayKey(day)}:${i}`,
          at: slot.at,
          title: `${plan.name} is due`,
          body: [plan.dose, `dose ${i + 1} of ${pd.expected} today`].filter(Boolean).join(' · '),
          tag: `med:${plan.id}`,
          source: 'meds',
          kind: 'due',
          url: '/app/meds',
          actions: [{ action: MED_GIVEN_ACTION, title: 'Given' }],
          requireInteraction: true,
        })
      })
    }
  }
  return out
}

/** Plan id of a reminder created by `plannedReminders`. */
export function planIdFromReminder(id: string): string | null {
  const m = /^med:(.+):\d{4}-\d{2}-\d{2}:\d+$/.exec(id)
  return m ? m[1]! : null
}

/** Plans with reminders whose current dose is overdue: their contribution to the badge. */
export function overdueCount(plans: MedPlan[], doses: MedDose[], now: number): number {
  return plans.filter((p) => !p.deletedAt && p.remind && planDay(p, doses, now, now).next?.overdue).length
}
