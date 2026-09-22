<script setup lang="ts">
import { ref, watch } from 'vue'
import { Bell, Trash2 } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import { formatDateTime, formatDuration, formatOffset, fromLocalInput, MINUTE, toLocalInput } from '@/core/time'
import KindPicker from './KindPicker.vue'
import type { FeedEntry, FeedKind } from '../logic/types'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{ entry: FeedEntry | null }>()
const emit = defineEmits<{ save: [entry: FeedEntry]; delete: [id: string] }>()

const when = ref('')
const kind = ref<FeedKind | undefined>()
const note = ref('')

watch(
  () => [open.value, props.entry] as const,
  ([isOpen, entry]) => {
    if (!isOpen || !entry) return
    when.value = toLocalInput(entry.at)
    kind.value = entry.kind
    note.value = entry.note ?? ''
  },
  { immediate: true },
)

function nudge(minutes: number) {
  const ms = fromLocalInput(when.value)
  if (ms != null) when.value = toLocalInput(ms + minutes * MINUTE)
}

function save() {
  if (!props.entry) return
  const at = fromLocalInput(when.value) ?? props.entry.at
  const next: FeedEntry = { ...props.entry, at: Math.min(at, Date.now() + 5 * MINUTE) }
  if (kind.value) next.kind = kind.value
  else delete next.kind
  if (note.value.trim()) next.note = note.value.trim()
  else delete next.note
  emit('save', next)
  open.value = false
}

function remove() {
  if (!props.entry) return
  emit('delete', props.entry.id)
  open.value = false
}
</script>

<template>
  <BottomSheet v-model="open" title="Edit feed">
    <div v-if="entry" class="stack">
      <label class="field">
        <span>Started</span>
        <input v-model="when" type="datetime-local" class="input" />
      </label>
      <div class="row nudges">
        <button class="btn sm" @click="nudge(-15)">−15m</button>
        <button class="btn sm" @click="nudge(-5)">−5m</button>
        <button class="btn sm" @click="nudge(5)">+5m</button>
        <button class="btn sm" @click="nudge(15)">+15m</button>
      </div>
      <KindPicker v-model="kind" />
      <label class="field">
        <span>Note</span>
        <textarea v-model="note" class="input" rows="2" placeholder="Optional" />
      </label>
      <p class="tiny faint">
        <Bell v-if="entry.source === 'notification'" :size="12" /> Logged {{ formatDateTime(entry.createdAt) }}
        {{ entry.source === 'notification' ? 'from a notification' : '' }} · planned next
        {{ formatDuration(entry.plan.baseMin) }}{{ entry.plan.offsetMin ? ` ${formatOffset(entry.plan.offsetMin)}` : '' }}{{
          entry.nextIntervalMin ? ` · set once to ${formatDuration(entry.nextIntervalMin)}` : ''
        }}
      </p>
      <button class="btn primary block lg" @click="save">Save</button>
      <ConfirmButton label="Delete feed" confirm-label="Tap again to delete" class="block" @confirm="remove">
        <Trash2 :size="18" />
      </ConfirmButton>
    </div>
  </BottomSheet>
</template>

<style scoped>
.nudges .btn {
  flex: 1;
  padding: 0;
}
</style>
