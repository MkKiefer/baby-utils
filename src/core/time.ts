export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** 150 → "2h 30m", 45 → "45m", 120 → "2h". */
export function formatDuration(minutes: number, opts: { zeroMinutes?: boolean } = {}): string {
  const sign = minutes < 0 ? '−' : ''
  const total = Math.round(Math.abs(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${sign}${m}m`
  if (m === 0 && !opts.zeroMinutes) return `${sign}${h}h`
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`
}

/** Signed offset: 30 → "+30m", -15 → "−15m". */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return '±0m'
  return minutes > 0 ? `+${formatDuration(minutes)}` : formatDuration(minutes)
}

/** Countdown for a time span in ms; "<1m" below a minute. */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / MINUTE)
  if (minutes < 1) return '<1m'
  return formatDuration(minutes)
}

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatClock = (ms: number) => clockFmt.format(ms)
export const formatDate = (d: Date | number) => dateFmt.format(d)
export const formatDateTime = (ms: number) => dateTimeFmt.format(ms)

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today", "Yesterday" or "Monday, 21 Sep". */
export function formatDayLabel(ms: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ms)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return dayFmt.format(ms)
}

/** Minutes since local midnight (DST-safe enough for display). */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

/** Value for `<input type="datetime-local">`. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number | null {
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}
