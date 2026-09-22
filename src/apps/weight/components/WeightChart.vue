<script setup lang="ts">
import { computed, ref } from 'vue'
import { DAY, formatShortDate } from '@/core/time'
import { formatChange, formatWeight, GRAMS_PER_LB } from '../logic/format'
import type { WeightEntry, WeightUnit } from '../logic/types'

/**
 * Weight over time: one series, so no legend — the card title names it. A dashed line
 * marks the birth weight when there is one; the unit is named in the card title. Hover or drag for a crosshair tooltip; the
 * history list is the table view.
 */
const props = defineProps<{ weights: WeightEntry[]; unit: WeightUnit; birth: WeightEntry | null }>()

const W = 340
const H = 190
const PAD = { top: 12, right: 12, bottom: 24, left: 40 }
const plotW = W - PAD.left - PAD.right
const plotH = H - PAD.top - PAD.bottom

/** Nice tick step in the display unit (kg or lb), returned in grams. */
function tickStep(spanGrams: number): number {
  const perUnit = props.unit === 'kg' ? 1000 : GRAMS_PER_LB
  const span = spanGrams / perUnit
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  return step * perUnit
}

const scale = computed(() => {
  const pts = props.weights
  const xs = pts.map((p) => p.at)
  const ys = pts.map((p) => p.grams)
  if (props.birth) ys.push(props.birth.grams)
  let x0 = Math.min(...xs)
  let x1 = Math.max(...xs)
  if (x1 - x0 < 2 * DAY) {
    x0 -= DAY
    x1 += DAY
  }
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const step = tickStep(Math.max(hi - lo, 400))
  const y0 = Math.floor((lo - step * 0.25) / step) * step
  const y1 = Math.ceil((hi + step * 0.25) / step) * step
  const ticks: number[] = []
  for (let v = y0; v <= y1 + 1; v += step) ticks.push(v)
  return {
    x: (t: number) => PAD.left + ((t - x0) / (x1 - x0)) * plotW,
    y: (g: number) => PAD.top + (1 - (g - y0) / (y1 - y0)) * plotH,
    ticks,
    x0,
    x1,
  }
})

function tickLabel(grams: number): string {
  if (props.unit === 'kg') return `${+(grams / 1000).toFixed(2)}`
  return `${+(grams / GRAMS_PER_LB).toFixed(1)}`
}

const points = computed(() => props.weights.map((e) => ({ e, x: scale.value.x(e.at), y: scale.value.y(e.grams) })))
const path = computed(() => points.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''))

const active = ref<number | null>(null)
const svg = ref<SVGSVGElement | null>(null)

function pick(ev: PointerEvent) {
  const el = svg.value
  if (!el || !points.value.length) return
  const rect = el.getBoundingClientRect()
  const x = ((ev.clientX - rect.left) / rect.width) * W
  let best = 0
  for (let i = 1; i < points.value.length; i++) {
    if (Math.abs(points.value[i]!.x - x) < Math.abs(points.value[best]!.x - x)) best = i
  }
  active.value = best
}

const tip = computed(() => {
  const i = active.value
  if (i == null) return null
  const p = points.value[i]
  if (!p) return null
  const prev = props.weights[i - 1]
  return {
    ...p,
    value: formatWeight(p.e.grams, props.unit),
    date: formatShortDate(p.e.at),
    change: prev ? formatChange(p.e.grams - prev.grams, props.unit) : null,
    /** Keep the tooltip inside the card. */
    left: `${Math.min(Math.max((p.x / W) * 100, 18), 82)}%`,
  }
})
</script>

<template>
  <div class="chart" @pointerleave="active = null">
    <svg
      ref="svg"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="`Weight chart, ${weights.length} weighings`"
      @pointermove="pick"
      @pointerdown="pick"
    >
      <g class="grid">
        <template v-for="t in scale.ticks" :key="t">
          <line :x1="PAD.left" :x2="W - PAD.right" :y1="scale.y(t)" :y2="scale.y(t)" />
          <text :x="PAD.left - 6" :y="scale.y(t)" dy="0.32em" text-anchor="end">{{ tickLabel(t) }}</text>
        </template>
        <text :x="PAD.left" :y="H - 6" text-anchor="start">{{ formatShortDate(scale.x0) }}</text>
        <text :x="W - PAD.right" :y="H - 6" text-anchor="end">{{ formatShortDate(scale.x1) }}</text>
      </g>
      <g v-if="birth" class="birth">
        <line :x1="PAD.left" :x2="W - PAD.right" :y1="scale.y(birth.grams)" :y2="scale.y(birth.grams)" />
        <text :x="W - PAD.right" :y="scale.y(birth.grams) - 4" text-anchor="end">birth</text>
      </g>
      <path :d="path" class="line" />
      <circle
        v-for="(p, i) in points"
        :key="p.e.id"
        :cx="p.x"
        :cy="p.y"
        :r="active === i ? 5.5 : 4"
        class="dot"
        :class="{ on: active === i }"
      />
      <line v-if="tip" class="cross" :x1="tip.x" :x2="tip.x" :y1="PAD.top" :y2="H - PAD.bottom" />
    </svg>
    <div v-if="tip" class="tip" :style="{ left: tip.left }">
      <strong class="num">{{ tip.value }}</strong>
      <span class="num">{{ tip.date }}<template v-if="tip.change"> · {{ tip.change }}</template></span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  touch-action: pan-y;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  user-select: none;
}

.grid line {
  stroke: var(--line);
  stroke-width: 1;
}

.grid text,
.birth text {
  font-size: 10px;
  font-weight: 700;
  fill: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.birth line {
  stroke: var(--text-3);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 2;
  transition: r 0.15s;
}

.cross {
  stroke: var(--line-2);
  stroke-width: 1;
}

.tip {
  position: absolute;
  top: -6px;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  background: var(--surface);
  box-shadow: var(--shadow);
  white-space: nowrap;
  pointer-events: none;
  line-height: 1.25;
}

.tip strong {
  font-size: 15px;
  font-weight: 900;
}

.tip span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}
</style>
