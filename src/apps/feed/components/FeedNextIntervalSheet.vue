<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BottomSheet from '@/components/BottomSheet.vue'
import DialInput from '@/components/DialInput.vue'
import { formatClock, formatDuration, MINUTE } from '@/core/time'
import { JAUNDICE_MAX_MIN, ONCE_MAX, ONCE_MIN } from '../logic/intervals'
import type { FeedPlan } from '../logic/plan'

/** One-time interval for the next feed only, counted from the start of the last feed. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ plan: FeedPlan; jaundice: boolean }>()
const emit = defineEmits<{ save: [minutes: number | null] }>()

const max = computed(() => (props.jaundice ? JAUNDICE_MAX_MIN : ONCE_MAX))
const minutes = ref(180)

watch(open, (v) => {
  if (!v) return
  const current = Math.round(props.plan.totalMin / 5) * 5
  minutes.value = Math.max(ONCE_MIN, Math.min(max.value, current))
})

const lastAt = computed(() => props.plan.lastFeed?.at ?? props.plan.now)
const dueAt = computed(() => lastAt.value + minutes.value * MINUTE)

function save() {
  emit('save', minutes.value)
  open.value = false
}

function reset() {
  emit('save', null)
  open.value = false
}
</script>

<template>
  <BottomSheet v-model="open" title="Next feed in">
    <div class="stack">
      <p class="muted small">
        Counted from the start of the last feed at {{ formatClock(lastAt) }}. Applies to the next feed only — after that
        the normal interval takes over again.
      </p>
      <DialInput
        v-model="minutes"
        :min="ONCE_MIN"
        :max="max"
        :step="5"
        label="Interval for the next feed"
        :tick-every="30"
        :label-every="60"
        :format-tick="(v) => (v % 60 ? '' : `${v / 60}h`)"
        :format="(v) => formatDuration(v)"
      >
        <strong class="num big">{{ formatDuration(minutes) }}</strong>
        <span class="chip accent num" style="margin-top: 6px">at {{ formatClock(dueAt) }}</span>
      </DialInput>
      <p v-if="jaundice" class="tiny muted">Capped at {{ formatDuration(JAUNDICE_MAX_MIN) }} while jaundice mode is on.</p>
      <button class="btn primary block lg" @click="save">Next feed at {{ formatClock(dueAt) }}</button>
      <button v-if="plan.onceMin" class="btn ghost block" @click="reset">Back to the normal interval</button>
    </div>
  </BottomSheet>
</template>

<style scoped>
.big {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: -0.02em;
}
</style>
