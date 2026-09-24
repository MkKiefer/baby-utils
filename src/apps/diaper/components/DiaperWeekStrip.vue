<script setup lang="ts">
import { computed } from 'vue'
import type { DayCount } from '../logic/stats'

/**
 * Wet and dirty diapers per day, as paired bars. Two series, so a small legend; the
 * counts are printed above each bar, so no axis is needed.
 */
const props = defineProps<{ days: DayCount[]; expected?: { wet: number; dirty: number | null } | null }>()

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
const max = computed(() => Math.max(1, props.expected?.wet ?? 0, ...props.days.map((d) => Math.max(d.wet, d.dirty))))
const pct = (n: number) => `${(n / max.value) * 100}%`
</script>

<template>
  <div class="strip" role="img" :aria-label="days.map((d) => `${weekday.format(d.day)} ${d.wet} wet ${d.dirty} dirty`).join(', ')">
    <div class="legend tiny">
      <span><i class="dot wet" /> Wet</span>
      <span><i class="dot dirty" /> Dirty</span>
    </div>
    <div class="bars">
      <div v-for="(d, i) in days" :key="d.day" class="day" :class="{ today: i === days.length - 1 }">
        <div class="pair">
          <div class="bar-wrap">
            <span class="n num">{{ d.wet || '' }}</span>
            <div class="bar wet" :style="{ height: pct(d.wet) }" />
          </div>
          <div class="bar-wrap">
            <span class="n num">{{ d.dirty || '' }}</span>
            <div class="bar dirty" :style="{ height: pct(d.dirty) }" />
          </div>
        </div>
        <span class="label tiny">{{ weekday.format(d.day) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  --wet: var(--accent);
  --dirty: color-mix(in oklab, #b08040 80%, var(--text));
}

.legend {
  display: flex;
  gap: 14px;
  margin-bottom: 10px;
  color: var(--text-2);
  font-weight: 700;
}

.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  vertical-align: -1px;
}

.dot.wet,
.bar.wet {
  background: var(--wet);
}

.dot.dirty,
.bar.dirty {
  background: var(--dirty);
}

.bars {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 6px;
}

.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.pair {
  display: flex;
  gap: 2px;
  width: 100%;
  justify-content: center;
}

.bar-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  width: 42%;
  max-width: 16px;
  height: 90px;
  padding-top: 16px;
}

.bar {
  width: 100%;
  min-height: 0;
  border-radius: 4px 4px 1px 1px;
}

.n {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-2);
  line-height: 14px;
}

.label {
  font-weight: 800;
  color: var(--text-3);
}

.today .label {
  color: var(--text);
}
</style>
