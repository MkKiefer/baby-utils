<script setup lang="ts">
import { computed } from 'vue'
import { formatClock, formatSpan } from '@/core/time'
import { useMedsStore } from '../store'

/** Live status on the home tile: the next or overdue dose, or how today went. */
const store = useMedsStore()
void store.ensureLoaded()

const text = computed(() => {
  const active = store.active
  if (!active.length) {
    return store.upcoming.length
      ? { main: 'Nothing due today', sub: `${store.upcoming[0]!.plan.name} starts later` }
      : { main: 'No active plans', sub: 'Tap to add one' }
  }
  const next = store.nextDue
  if (next) {
    const { plan, today } = next.view
    const n = today.next!
    if (n.overdue) return { main: `${plan.name} overdue`, sub: `due ${formatClock(n.at)} · ${formatSpan(store.now - n.at)} ago` }
    if (n.at <= store.now) return { main: `${plan.name} due now`, sub: `${today.given} of ${today.expected} given today` }
    return { main: `${plan.name} at ${formatClock(n.at)}`, sub: `${n.approx ? 'about ' : ''}in ${formatSpan(n.at - store.now)}` }
  }
  const open = active.filter((v) => v.today.doseDay && !v.today.done && !v.plan.asNeeded)
  if (open.length) return { main: `${open[0]!.plan.name} due today`, sub: `${open.length} ${open.length === 1 ? 'plan' : 'plans'} open` }
  const given = active.reduce((n, v) => n + v.today.given, 0)
  return { main: 'All given today', sub: `${given} ${given === 1 ? 'dose' : 'doses'} · ${active.length} active` }
})
</script>

<template>
  <div class="meds-tile">
    <strong class="num">{{ text.main }}</strong>
    <span class="num">{{ text.sub }}</span>
  </div>
</template>

<style scoped>
.meds-tile {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
}

strong {
  font-size: 16px;
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}
</style>
