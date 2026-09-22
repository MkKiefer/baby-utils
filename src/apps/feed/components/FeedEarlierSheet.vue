<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BottomSheet from '@/components/BottomSheet.vue'
import DialInput from '@/components/DialInput.vue'
import { formatClock, formatDuration, MINUTE } from '@/core/time'
import KindPicker from './KindPicker.vue'
import type { FeedKind } from '../logic/types'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ suggested?: FeedKind | null; initialKind?: FeedKind }>()
const emit = defineEmits<{ save: [at: number, kind: FeedKind | undefined] }>()

const minutesAgo = ref(15)
const kind = ref<FeedKind | undefined>()
const openedAt = ref(Date.now())

watch(open, (v) => {
  if (!v) return
  minutesAgo.value = 15
  kind.value = props.initialKind
  openedAt.value = Date.now()
})

const at = computed(() => openedAt.value - minutesAgo.value * MINUTE)

function save() {
  emit('save', at.value, kind.value)
  open.value = false
}
</script>

<template>
  <BottomSheet v-model="open" title="Fed earlier">
    <div class="stack">
      <p class="muted small">Turn the dial to when feeding started.</p>
      <DialInput
        v-model="minutesAgo"
        :min="0"
        :max="180"
        :step="5"
        label="Minutes ago"
        :tick-every="15"
        :label-every="60"
        :format-tick="(v) => (v ? `${v / 60}h` : 'now')"
        :format="(v) => formatDuration(v)"
      >
        <strong class="num big">{{ minutesAgo ? formatDuration(minutesAgo) : 'Now' }}</strong>
        <span class="muted small">{{ minutesAgo ? 'ago' : '' }}</span>
        <span class="chip accent num" style="margin-top: 6px">{{ formatClock(at) }}</span>
      </DialInput>
      <KindPicker v-model="kind" :suggested="suggested" />
      <button class="btn primary block lg" @click="save">Log feed at {{ formatClock(at) }}</button>
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
