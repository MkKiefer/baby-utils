<script setup lang="ts">
import { computed } from 'vue'
import { formatDayLabel } from '@/core/time'
import { formatChange, formatWeight } from '../logic/format'
import { useWeightStore } from '../store'

/** Live status on the home tile: latest weight and change since the one before. */
const store = useWeightStore()
void store.ensureLoaded()

const text = computed(() => {
  const { latest, change } = store.stats
  if (!latest) return { main: 'No weighings yet', sub: 'Tap to log one' }
  return {
    main: formatWeight(latest.grams, store.unit),
    sub: `${formatDayLabel(latest.at)}${change != null ? ` · ${formatChange(change, store.unit)}` : ''}`,
  }
})
</script>

<template>
  <div class="weight-tile">
    <strong class="num">{{ text.main }}</strong>
    <span class="num">{{ text.sub }}</span>
  </div>
</template>

<style scoped>
.weight-tile {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
}

strong {
  font-size: 16px;
  font-weight: 900;
}

span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}
</style>
