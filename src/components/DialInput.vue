<script setup lang="ts">
import { computed, ref } from 'vue'
import { arcPath, pointerAngle, polar } from '@/core/arc'

/** Circular slider: drag the knob around the dial, or use the arrow keys. */
const value = defineModel<number>({ required: true })
const props = withDefaults(
  defineProps<{
    min: number
    max: number
    step?: number
    sweep?: number
    label: string
    format?: (v: number) => string
    tickEvery?: number
    labelEvery?: number
    formatTick?: (v: number) => string
  }>(),
  { step: 1, sweep: 300, format: (v: number) => String(v), tickEvery: 0, labelEvery: 0, formatTick: (v: number) => String(v) },
)

const C = 150
const R = 104
const start = computed(() => -props.sweep / 2)
const svg = ref<SVGSVGElement>()
const dragging = ref(false)

const t = computed(() => (value.value - props.min) / (props.max - props.min))
const valueDeg = computed(() => start.value + t.value * props.sweep)
const knob = computed(() => polar(C, C, R, valueDeg.value))

const ticks = computed(() => {
  if (!props.tickEvery) return []
  const out = []
  for (let v = props.min; v <= props.max + 1e-9; v += props.tickEvery) {
    const deg = start.value + ((v - props.min) / (props.max - props.min)) * props.sweep
    const major = !!props.labelEvery && Math.abs((v - props.min) % props.labelEvery) < 1e-9
    out.push({
      v,
      major,
      a: polar(C, C, major ? 120 : 122, deg),
      b: polar(C, C, 128, deg),
      label: polar(C, C, 142, deg),
    })
  }
  return out
})

function clamp(v: number) {
  const stepped = Math.round((v - props.min) / props.step) * props.step + props.min
  return Math.min(props.max, Math.max(props.min, stepped))
}

function fromPointer(e: PointerEvent) {
  const rect = svg.value!.getBoundingClientRect()
  const scale = 300 / rect.width
  const a = pointerAngle(C, C, (e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale)
  const rel = (a - start.value + 360) % 360
  let next = rel <= props.sweep ? rel / props.sweep : rel - props.sweep < 360 - rel ? 1 : 0
  // Never jump across the gap between max and min while dragging.
  if (dragging.value && Math.abs(next - t.value) > 0.5) next = t.value > 0.5 ? 1 : 0
  const v = clamp(props.min + next * (props.max - props.min))
  if (v !== value.value) {
    value.value = v
    navigator.vibrate?.(2)
  }
}

function onDown(e: PointerEvent) {
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  dragging.value = false
  fromPointer(e)
  dragging.value = true
}

function onMove(e: PointerEvent) {
  if (dragging.value) fromPointer(e)
}

function onUp() {
  dragging.value = false
}

function onKey(e: KeyboardEvent) {
  const big = props.step * 6
  const delta: Record<string, number> = {
    ArrowUp: props.step,
    ArrowRight: props.step,
    ArrowDown: -props.step,
    ArrowLeft: -props.step,
    PageUp: big,
    PageDown: -big,
  }
  if (e.key in delta) {
    e.preventDefault()
    value.value = clamp(value.value + delta[e.key])
  } else if (e.key === 'Home') value.value = props.min
  else if (e.key === 'End') value.value = props.max
}
</script>

<template>
  <div class="dial" :class="{ dragging }">
    <svg
      ref="svg"
      viewBox="0 0 300 300"
      role="slider"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="value"
      :aria-valuetext="format(value)"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onKey"
    >
      <defs>
        <filter id="dial-knob-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity="0.25" />
        </filter>
      </defs>
      <path :d="arcPath(C, C, R, start, start + sweep)" class="track" />
      <path v-if="t > 0.001" :d="arcPath(C, C, R, start, valueDeg)" class="fill" />
      <g class="ticks">
        <line
          v-for="tick in ticks"
          :key="tick.v"
          :x1="tick.a.x"
          :y1="tick.a.y"
          :x2="tick.b.x"
          :y2="tick.b.y"
          :class="{ major: tick.major }"
        />
        <template v-for="tick in ticks" :key="`l${tick.v}`">
          <text v-if="tick.major" :x="tick.label.x" :y="tick.label.y" dominant-baseline="central" text-anchor="middle">
            {{ formatTick(tick.v) }}
          </text>
        </template>
      </g>
      <circle :cx="knob.x" :cy="knob.y" r="17" class="knob" filter="url(#dial-knob-shadow)" />
      <circle :cx="knob.x" :cy="knob.y" r="6" class="knob-dot" />
    </svg>
    <div class="center">
      <slot :value="value">
        <strong class="num">{{ format(value) }}</strong>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.dial {
  position: relative;
  width: min(100%, 300px);
  aspect-ratio: 1;
  margin: 0 auto;
  touch-action: none;
  user-select: none;
}

svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  cursor: grab;
  outline: none;
}

.dragging svg {
  cursor: grabbing;
}

svg:focus-visible .knob {
  stroke-width: 6;
}

.track,
.fill {
  fill: none;
  stroke-width: 22;
  stroke-linecap: round;
}

.track {
  stroke: var(--track);
}

.fill {
  stroke: var(--accent);
}

.ticks line {
  stroke: var(--text-3);
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0.6;
}

.ticks line.major {
  stroke: var(--text-2);
  stroke-width: 2.5;
  opacity: 1;
}

.ticks text {
  font-size: 12px;
  font-weight: 800;
  fill: var(--text-3);
}

.knob {
  fill: var(--surface);
  stroke: var(--accent);
  stroke-width: 4;
  transition: r 0.15s;
}

.dragging .knob {
  r: 20;
}

.knob-dot {
  fill: var(--accent);
}

.center {
  position: absolute;
  inset: 26%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
}

.center strong {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: -0.02em;
}
</style>
