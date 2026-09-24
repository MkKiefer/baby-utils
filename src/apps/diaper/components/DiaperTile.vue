<script setup lang="ts">
import { computed } from 'vue'
import { formatSpan } from '@/core/time'
import { useDiaperStore } from '../store'

/** Live status on the home tile: today's counts and time since the last change. */
const store = useDiaperStore()
void store.ensureLoaded()

const text = computed(() => {
  const { latest, today } = store.stats
  if (!latest) return { main: 'No diapers yet', sub: 'Tap to log one' }
  return {
    main: `${today.wet} wet · ${today.dirty} dirty`,
    sub: `today · last ${formatSpan(store.now - latest.at)} ago`,
  }
})
</script>

<template>
  <div class="diaper-tile">
    <strong class="num">{{ text.main }}</strong>
    <span class="num">{{ text.sub }}</span>
  </div>
</template>

<style scoped>
.diaper-tile {
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
