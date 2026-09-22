<script setup lang="ts">
import { computed } from 'vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { formatWeight } from '../logic/format'
import { useWeightStore } from '../store'
import type { WeightUnit } from '../logic/types'

const store = useWeightStore()
void store.ensureLoaded()

const unit = computed<WeightUnit>({
  get: () => store.settings.unit,
  set: (value) => void store.saveSettings({ unit: value }),
})
</script>

<template>
  <div class="page">
    <h2 class="section-title">Unit</h2>
    <div class="card stack">
      <SegmentedControl
        v-model="unit"
        label="Weight unit"
        :options="[
          { value: 'kg', label: 'kg / g' },
          { value: 'lb', label: 'lb / oz' },
        ]"
      />
      <p class="tiny muted">
        Weights are stored in grams, so switching only changes how they are shown and entered — e.g.
        {{ formatWeight(3450, unit) }}. The unit is a setting of this phone and is not synced.
      </p>
    </div>

    <h2 class="section-title">About</h2>
    <div class="card">
      <p class="small muted">
        The first weighing within two days of the birth date is treated as the birth weight. Weighings sync with your other
        phones when sync is on. For a meaningful curve, weigh at a similar time of day, with the same amount of clothing, on
        the same scale.
      </p>
    </div>
  </div>
</template>
