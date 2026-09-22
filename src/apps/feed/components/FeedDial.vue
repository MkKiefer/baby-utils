<script setup lang="ts">
import { computed } from 'vue'
import { arcPath, polar } from '@/core/arc'
import { DAY, formatClock, formatDuration, formatOffset, formatSpan, minutesOfDay, MINUTE } from '@/core/time'
import type { FeedPlan } from '../logic/plan'
import type { FeedEntry } from '../logic/types'

/**
 * Two faces, tap to switch:
 * - timer: the ring is the current interval (age part solid, rhythm extension striped)
 * - day:   a 24h clock with night shading, today's feeds as dots and a "now" hand
 */
const props = defineProps<{ plan: FeedPlan; feeds: FeedEntry[]; mode: 'timer' | 'day' }>()
const emit = defineEmits<{ toggle: [] }>()

const C = 160
const R = 118
const NIGHT_FROM = 20 * 60
const NIGHT_TO = 7 * 60

const now = computed(() => props.plan.now)
const last = computed(() => props.plan.lastFeed)
const cycle = computed(() => props.plan.cycles[0] ?? null)
const tone = computed(() => {
  switch (props.plan.status) {
    case 'due':
    case 'overdue':
      return 'warn'
    case 'paused':
      return 'muted'
    default:
      return 'accent'
  }
})

// ---------------------------------------------------------------- timer face
const spanMin = computed(() => Math.max(props.plan.baseMin, props.plan.totalMin))
const elapsedMin = computed(() => (last.value ? (now.value - last.value.at) / MINUTE : 0))
const timer = computed(() => {
  const span = spanMin.value
  const baseDeg = (props.plan.baseMin / span) * 360
  const dueDeg = (props.plan.totalMin / span) * 360
  const progDeg = Math.min(elapsedMin.value / span, 1) * 360
  const ticks = []
  for (let m = 30; m < span; m += 30) {
    const deg = (m / span) * 360
    ticks.push({ m, hour: m % 60 === 0, a: polar(C, C, R + 17, deg), b: polar(C, C, R + (m % 60 === 0 ? 25 : 21), deg), label: polar(C, C, R + 38, deg) })
  }
  return {
    baseDeg,
    dueDeg,
    progDeg,
    ticks,
    knob: polar(C, C, R, progDeg),
    baseMark: polar(C, C, R, baseDeg),
    dueMark: polar(C, C, R, dueDeg),
  }
})

// ---------------------------------------------------------------- day face
const deg24 = (ms: number) => (minutesOfDay(ms) / 1440) * 360
const day = computed(() => {
  const hours = Array.from({ length: 24 }, (_, h) => {
    const deg = h * 15
    return {
      h,
      major: h % 6 === 0,
      a: polar(C, C, R + 17, deg),
      b: polar(C, C, R + (h % 6 === 0 ? 26 : 21), deg),
      label: polar(C, C, R - 36, deg),
    }
  })
  const nightStart = (NIGHT_FROM / 1440) * 360
  const nightEnd = 360 + (NIGHT_TO / 1440) * 360
  const dots = props.feeds
    .filter((f) => f.at > now.value - DAY && f.at <= now.value)
    .map((f) => ({
      id: f.id,
      p: polar(C, C, R, deg24(f.at)),
      opacity: 0.45 + 0.55 * (1 - (now.value - f.at) / DAY),
    }))
  let interval = null
  if (last.value && cycle.value) {
    const start = deg24(last.value.at)
    const toDeg = (ms: number) => start + ((ms - last.value!.at) / DAY) * 360
    interval = {
      start,
      due: toDeg(cycle.value.dueAt),
      base: toDeg(cycle.value.baseAt),
      now: toDeg(Math.min(now.value, last.value.at + DAY - MINUTE)),
    }
  }
  const nowDeg = deg24(now.value)
  return {
    hours,
    nightStart,
    nightEnd,
    dots,
    interval,
    handA: polar(C, C, R - 20, nowDeg),
    handB: polar(C, C, R + 16, nowDeg),
  }
})

// ---------------------------------------------------------------- centre text
const centre = computed(() => {
  const p = props.plan
  if (!last.value || !cycle.value) return { label: 'Ready when you are', big: '—', sub: 'Log the first feed below' }
  const due = cycle.value.dueAt
  switch (p.status) {
    case 'ok':
    case 'soon':
      return { label: 'Next feed in', big: formatSpan(due - now.value), sub: `at ${formatClock(due)}` }
    case 'due':
      return {
        label: 'Feeding time',
        big: now.value - due < MINUTE ? 'Now' : `+${formatSpan(now.value - due)}`,
        sub: `was due ${formatClock(due)}`,
      }
    case 'overdue':
      return { label: 'Overdue by', big: formatSpan(now.value - due), sub: `was due ${formatClock(due)}` }
    case 'paused':
      return { label: 'Reminders paused', big: formatSpan(now.value - last.value.at), sub: 'since the last logged feed' }
    default:
      return { label: '', big: '', sub: '' }
  }
})

const intervalLabel = computed(() => {
  const p = props.plan
  return p.offsetMin ? `${formatDuration(p.baseMin)} ${formatOffset(p.offsetMin)}` : formatDuration(p.baseMin)
})
</script>

<template>
  <button
    type="button"
    class="feed-dial"
    :class="[`tone-${tone}`, `status-${plan.status}`]"
    :aria-label="`${centre.label} ${centre.big} ${centre.sub}. Tap to switch dial view.`"
    @click="emit('toggle')"
  >
    <svg viewBox="0 0 320 320" aria-hidden="true">
      <defs>
        <filter id="feed-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="feed-knob" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3" />
        </filter>
      </defs>

      <!-- ============ timer face ============ -->
      <g v-if="mode === 'timer'">
        <circle :cx="C" :cy="C" :r="R" class="track" />
        <template v-if="last">
          <path v-if="plan.offsetMin > 0" :d="arcPath(C, C, R, timer.baseDeg, 360)" class="rhythm" />
          <path :d="arcPath(C, C, R, 0, timer.progDeg)" class="glow" filter="url(#feed-glow)" />
          <path :d="arcPath(C, C, R, 0, timer.progDeg)" class="progress" />
          <g class="ticks">
            <line v-for="t in timer.ticks" :key="t.m" :x1="t.a.x" :y1="t.a.y" :x2="t.b.x" :y2="t.b.y" :class="{ major: t.hour }" />
            <template v-for="t in timer.ticks" :key="`l${t.m}`">
              <text v-if="t.hour" :x="t.label.x" :y="t.label.y" text-anchor="middle" dominant-baseline="central">
                {{ t.m / 60 }}h
              </text>
            </template>
          </g>
          <circle v-if="plan.offsetMin !== 0" :cx="timer.baseMark.x" :cy="timer.baseMark.y" r="4" class="mark" />
          <circle :cx="timer.dueMark.x" :cy="timer.dueMark.y" r="4" class="mark due" />
          <circle :cx="timer.knob.x" :cy="timer.knob.y" r="11" class="knob" filter="url(#feed-knob)" />
        </template>
      </g>

      <!-- ============ day face ============ -->
      <g v-else>
        <circle :cx="C" :cy="C" :r="R" class="track" />
        <path :d="arcPath(C, C, R, day.nightStart, day.nightEnd)" class="night" />
        <g class="ticks">
          <line v-for="t in day.hours" :key="t.h" :x1="t.a.x" :y1="t.a.y" :x2="t.b.x" :y2="t.b.y" :class="{ major: t.major }" />
          <template v-for="t in day.hours" :key="`l${t.h}`">
            <text v-if="t.major" :x="t.label.x" :y="t.label.y" text-anchor="middle" dominant-baseline="central" class="hour">
              {{ String(t.h).padStart(2, '0') }}
            </text>
          </template>
        </g>
        <template v-if="day.interval">
          <path :d="arcPath(C, C, R, day.interval.start, day.interval.due)" class="planned" />
          <path :d="arcPath(C, C, R, day.interval.start, Math.min(day.interval.now, day.interval.due))" class="progress" />
          <path
            v-if="day.interval.now > day.interval.due"
            :d="arcPath(C, C, R, day.interval.due, day.interval.now)"
            class="progress over"
          />
        </template>
        <circle v-for="d in day.dots" :key="d.id" :cx="d.p.x" :cy="d.p.y" r="7" class="dot" :style="{ opacity: d.opacity }" />
        <line :x1="day.handA.x" :y1="day.handA.y" :x2="day.handB.x" :y2="day.handB.y" class="hand" />
      </g>
    </svg>

    <div class="centre">
      <span class="label">{{ centre.label }}</span>
      <strong class="big num">{{ centre.big }}</strong>
      <span class="sub num">{{ centre.sub }}</span>
      <span v-if="last" class="interval num">{{ intervalLabel }}</span>
    </div>
  </button>
</template>

<style scoped>
.feed-dial {
  position: relative;
  display: block;
  width: min(100%, 340px);
  aspect-ratio: 1;
  margin: 0 auto;
  --tone: var(--accent);
}

.tone-warn {
  --tone: var(--warn);
}

.tone-muted {
  --tone: var(--text-3);
}

svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.track {
  fill: none;
  stroke: var(--track);
  stroke-width: 24;
}

.night {
  fill: none;
  stroke: var(--track-night);
  stroke-width: 24;
}

.rhythm {
  fill: none;
  stroke: var(--tone);
  stroke-width: 24;
  stroke-dasharray: 2.5 4.5;
  opacity: 0.45;
}

.planned {
  fill: none;
  stroke: var(--tone);
  stroke-width: 24;
  stroke-linecap: round;
  opacity: 0.25;
}

.progress,
.glow {
  fill: none;
  stroke: var(--tone);
  stroke-width: 24;
  stroke-linecap: round;
  transition: stroke 0.4s;
}

.glow {
  opacity: 0.35;
}

.progress.over {
  stroke: var(--warn);
}

.status-due .glow,
.status-due .knob {
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}

.ticks line {
  stroke: var(--text-3);
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0.7;
}

.ticks line.major {
  stroke: var(--text-2);
  stroke-width: 2.5;
}

.ticks text {
  font-size: 12px;
  font-weight: 800;
  fill: var(--text-3);
}

.ticks text.hour {
  font-size: 13px;
  fill: var(--text-3);
}

.mark {
  fill: var(--surface);
}

.mark.due {
  fill: var(--surface);
  stroke: var(--tone);
  stroke-width: 2;
}

.knob {
  fill: var(--surface);
  stroke: var(--tone);
  stroke-width: 4;
}

.dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 3;
}

.hand {
  stroke: var(--text);
  stroke-width: 3;
  stroke-linecap: round;
}

.centre {
  position: absolute;
  inset: 24%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 2px;
  pointer-events: none;
}

.label {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-2);
}

.big {
  font-size: clamp(34px, 11vw, 46px);
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: -0.03em;
  color: var(--text);
}

.tone-warn .big {
  color: var(--warn);
}

.sub {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-2);
}

.interval {
  margin-top: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  background: color-mix(in oklab, var(--tone) 14%, transparent);
  color: color-mix(in oklab, var(--tone) 75%, var(--text));
}
</style>
