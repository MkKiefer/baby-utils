import type { MedPlan } from './types'

type ScheduleFields = Pick<MedPlan, 'timesPerDay' | 'everyDays' | 'days' | 'asNeeded'>

const EVERY: Record<number, string> = { 1: 'a day', 2: 'every 2nd day', 3: 'every 3rd day', 7: 'once a week' }

/** "3× a day for 5 days (15 doses)", "1× every 2nd day, ongoing", "As needed, up to 4× a day". */
export function describeSchedule(plan: ScheduleFields): string {
  if (plan.asNeeded) {
    const base = `As needed, up to ${plan.timesPerDay}× a day`
    return plan.days ? `${base} for ${plan.days} ${plan.days === 1 ? 'day' : 'days'}` : base
  }
  const every = Math.max(1, plan.everyDays)
  const freq = `${plan.timesPerDay}× ${EVERY[every] ?? `every ${every} days`}`
  if (!plan.days) return `${freq}, ongoing`
  const doses = Math.ceil(plan.days / every) * plan.timesPerDay
  return `${freq} for ${plan.days} ${plan.days === 1 ? 'day' : 'days'} (${doses} ${doses === 1 ? 'dose' : 'doses'})`
}
