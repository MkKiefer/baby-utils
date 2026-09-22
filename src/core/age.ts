/**
 * Age maths on local calendar dates. Birth dates are stored as `YYYY-MM-DD` so they never
 * shift with time zones or DST.
 */

export interface AgeInfo {
  days: number
  weeks: number
  months: number
  years: number
  /** Days left over after whole calendar months. */
  daysAfterMonths: number
  /** Months left over after whole years. */
  monthsAfterYears: number
  unit: 'days' | 'weeks' | 'months' | 'years'
  /** e.g. "5 weeks 3 days" */
  primary: string
}

export interface Milestone {
  label: string
  date: Date
  inDays: number
}

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Whole calendar days from `a` to `b` (ignores time of day and DST). */
export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / 86_400_000)
}

/** Adds calendar months, clamping the day (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getFullYear()
  const m = date.getMonth() + months
  const lastDay = new Date(y, m + 1, 0).getDate()
  return new Date(y, m, Math.min(date.getDate(), lastDay))
}

export function wholeMonthsBetween(birth: Date, today: Date): number {
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth())
  if (addMonths(birth, months) > startOf(today)) months--
  return Math.max(0, months)
}

function startOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function join(a: string, b: string | null): string {
  return b ? `${a} ${b}` : a
}

/**
 * Resolution grows with the baby:
 * < 14 days → days, < 3 months → weeks + days, < 2 years → months + weeks, then years + months.
 */
export function ageInfo(birthIso: string, now: Date = new Date()): AgeInfo {
  const birth = parseLocalDate(birthIso)
  const days = Math.max(0, daysBetween(birth, now))
  const weeks = Math.floor(days / 7)
  const months = wholeMonthsBetween(birth, now)
  const daysAfterMonths = Math.max(0, daysBetween(addMonths(birth, months), now))
  const years = Math.floor(months / 12)
  const monthsAfterYears = months % 12

  let unit: AgeInfo['unit']
  let primary: string
  if (days < 14) {
    unit = 'days'
    primary = days === 0 ? 'Born today' : plural(days, 'day')
  } else if (months < 3) {
    unit = 'weeks'
    primary = join(plural(weeks, 'week'), days % 7 ? plural(days % 7, 'day') : null)
  } else if (years < 2) {
    unit = 'months'
    const w = Math.floor(daysAfterMonths / 7)
    primary = join(plural(months, 'month'), w ? plural(w, 'week') : null)
  } else {
    unit = 'years'
    primary = join(plural(years, 'year'), monthsAfterYears ? plural(monthsAfterYears, 'month') : null)
  }

  return { days, weeks, months, years, daysAfterMonths, monthsAfterYears, unit, primary }
}

export function ageDays(birthIso: string, at: Date | number = new Date()): number {
  return Math.max(0, daysBetween(parseLocalDate(birthIso), new Date(at)))
}

type MilestoneDef = { label: string } & ({ days: number } | { months: number })

const MILESTONES: MilestoneDef[] = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', months: 1 },
  { label: '6 weeks', days: 42 },
  { label: '2 months', months: 2 },
  { label: '100 days', days: 100 },
  { label: '3 months', months: 3 },
  { label: '4 months', months: 4 },
  { label: '5 months', months: 5 },
  { label: 'Half a year', months: 6 },
  { label: '9 months', months: 9 },
  { label: '1 year', months: 12 },
  { label: '500 days', days: 500 },
  { label: '18 months', months: 18 },
  { label: '2 years', months: 24 },
  { label: '1000 days', days: 1000 },
  { label: '3 years', months: 36 },
]

/** Next milestone on or after today (`inDays === 0` means today). */
export function nextMilestone(birthIso: string, now: Date = new Date()): Milestone | null {
  const birth = parseLocalDate(birthIso)
  const upcoming = MILESTONES.map((m) => {
    const date =
      'days' in m
        ? new Date(birth.getFullYear(), birth.getMonth(), birth.getDate() + m.days)
        : addMonths(birth, m.months)
    return { label: m.label, date, inDays: daysBetween(now, date) }
  })
    .filter((m) => m.inDays >= 0)
    .sort((a, b) => a.inDays - b.inDays)
  return upcoming[0] ?? null
}
