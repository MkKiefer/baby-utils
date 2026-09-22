<script setup lang="ts">
import { computed, ref } from 'vue'
import { DAY, formatClock, formatDayLabel, minutesOfDay, startOfDay } from '@/core/time'
import type { FeedEntry } from '../logic/types'
import { KIND_LABEL } from '../logic/types'

/** Seven rows (days) × 24h: every feed as a dot, night hours shaded. Tap a dot for details. */
const props = defineProps<{ feeds: FeedEntry[]; now: number; days?: number }>()

const W = 340
const LEFT = 44
const RIGHT = 26
const ROW = 28
const TOP = 6
const plotW = W - LEFT - RIGHT
const dayCount = computed(() => props.days ?? 7)
const height = computed(() => TOP + dayCount.value * ROW + 22)
const x = (minutes: number) => LEFT + (minutes / 1440) * plotW

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

const rows = computed(() => {
  const today = startOfDay(props.now)
  return Array.from({ length: dayCount.value }, (_, i) => {
    const start = today - i * DAY
    const end = start + DAY
    const feeds = props.feeds.filter((f) => f.at >= start && f.at < end)
    return {
      start,
      y: TOP + i * ROW + ROW / 2,
      label: i === 0 ? 'Today' : weekday.format(start),
      count: feeds.length,
      dots: feeds.map((f) => ({ f, cx: x(minutesOfDay(f.at)) })),
    }
  })
})

const selected = ref<{ f: FeedEntry; cx: number; y: number } | null>(null)

function select(f: FeedEntry, cx: number, y: number) {
  selected.value = selected.value?.f.id === f.id ? null : { f, cx, y }
}

const tooltip = computed(() => {
  const s = selected.value
  if (!s) return null
  const kind = s.f.kind ? ` · ${KIND_LABEL[s.f.kind]}` : ''
  return {
    text: `${formatDayLabel(s.f.at, props.now)} ${formatClock(s.f.at)}${kind}`,
    left: `${Math.min(80, Math.max(20, (s.cx / W) * 100))}%`,
    top: `${(s.y / height.value) * 100}%`,
    below: s.y < TOP + ROW * 2,
  }
})
</script>

<template>
  <div class="strip" @click.self="selected = null">
    <svg :viewBox="`0 0 ${W} ${height}`" role="img" :aria-label="`Feeds over the last ${dayCount} days by time of day`">
      <!-- night wash: 20:00–24:00 and 00:00–07:00 -->
      <rect :x="x(0)" :y="TOP" :width="x(420) - x(0)" :height="dayCount * ROW" class="night" rx="6" />
      <rect :x="x(1200)" :y="TOP" :width="x(1440) - x(1200)" :height="dayCount * ROW" class="night" rx="6" />
      <line
        v-for="h in [0, 6, 12, 18, 24]"
        :key="h"
        :x1="x(h * 60)"
        :x2="x(h * 60)"
        :y1="TOP"
        :y2="TOP + dayCount * ROW"
        class="grid"
      />
      <text
        v-for="h in [0, 6, 12, 18, 24]"
        :key="`t${h}`"
        :x="x(h * 60)"
        :y="TOP + dayCount * ROW + 14"
        text-anchor="middle"
        class="axis"
      >
        {{ String(h).padStart(2, '0') }}
      </text>
      <g v-for="row in rows" :key="row.start">
        <text :x="0" :y="row.y" dominant-baseline="central" class="day">{{ row.label }}</text>
        <text :x="W" :y="row.y" dominant-baseline="central" text-anchor="end" class="count num">{{ row.count || '' }}</text>
        <g v-for="d in row.dots" :key="d.f.id" class="hit" @click.stop="select(d.f, d.cx, row.y)">
          <circle :cx="d.cx" :cy="row.y" r="12" fill="transparent" />
          <circle :cx="d.cx" :cy="row.y" r="5.5" class="dot" :class="{ on: selected?.f.id === d.f.id }" />
        </g>
      </g>
    </svg>
    <div v-if="tooltip" class="tip" :class="{ below: tooltip.below }" :style="{ left: tooltip.left, top: tooltip.top }">{{ tooltip.text }}</div>
  </div>
</template>

<style scoped>
.strip {
  position: relative;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.night {
  fill: var(--track-night);
  opacity: 0.55;
}

.grid {
  stroke: var(--line-2);
  stroke-width: 1;
}

.axis,
.day,
.count {
  font-size: 11px;
  font-weight: 800;
  fill: var(--text-3);
}

.day {
  fill: var(--text-2);
}

.hit {
  cursor: pointer;
}

.dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 2;
  transition: r 0.15s;
}

.dot.on {
  r: 7.5;
}

.tip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--text);
  color: var(--bg);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow);
}

.tip.below {
  transform: translate(-50%, 14px);
}
</style>
