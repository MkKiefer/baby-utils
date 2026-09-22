<script setup lang="ts">
import { computed } from 'vue'
import { arcPath } from '@/core/arc'
import { formatClock, formatSpan, MINUTE } from '@/core/time'
import { useFeedStore } from '../store'

/** Live status on the home tile: small ring + next feed. */
const store = useFeedStore()
void store.ensureLoaded()

const plan = computed(() => store.plan)
const progress = computed(() => {
  const p = plan.value
  return p.lastFeed ? Math.min(1, (p.now - p.lastFeed.at) / (p.totalMin * MINUTE)) : 0
})
const text = computed(() => {
  const p = plan.value
  const c = p.cycles[0]
  if (!p.lastFeed || !c) return { main: 'No feeds yet', sub: 'Tap to start' }
  switch (p.status) {
    case 'ok':
    case 'soon':
      return { main: `in ${formatSpan(c.dueAt - p.now)}`, sub: `next at ${formatClock(c.dueAt)}` }
    case 'due':
      return { main: 'Feeding time', sub: `due ${formatClock(c.dueAt)}` }
    case 'overdue':
      return { main: `+${formatSpan(p.now - c.dueAt)}`, sub: 'overdue' }
    default:
      return { main: 'Paused', sub: `last ${formatClock(p.lastFeed.at)}` }
  }
})
const warn = computed(() => plan.value.status === 'due' || plan.value.status === 'overdue')
</script>

<template>
  <div class="feed-tile" :class="{ warn }">
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" class="track" />
      <path :d="arcPath(20, 20, 16, 0, progress * 360)" class="arc" />
    </svg>
    <div class="txt">
      <strong class="num">{{ text.main }}</strong>
      <span class="num">{{ text.sub }}</span>
    </div>
  </div>
</template>

<style scoped>
.feed-tile {
  display: flex;
  align-items: center;
  gap: 10px;
}

svg {
  width: 34px;
  height: 34px;
  flex: none;
}

.track {
  fill: none;
  stroke: var(--track);
  stroke-width: 5;
}

.arc {
  fill: none;
  stroke: var(--accent);
  stroke-width: 5;
  stroke-linecap: round;
}

.warn .arc {
  stroke: var(--warn);
}

.txt {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
}

strong {
  font-size: 16px;
  font-weight: 900;
}

.warn strong {
  color: var(--warn);
}

span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}
</style>
