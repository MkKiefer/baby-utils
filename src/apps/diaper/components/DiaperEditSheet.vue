<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import { formatDateTime, fromLocalInput, MINUTE, toLocalInput } from '@/core/time'
import StoolPicker from './StoolPicker.vue'
import type { NewDiaper } from '../logic/repo'
import { DIAPER_ACCENT, DIAPER_KINDS, isDirty, isWarnStool, KIND_LABEL, type DiaperEntry, type DiaperKind, type StoolColor } from '../logic/types'

/** Log a diaper with details (`entry` null) or edit one. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ entry: DiaperEntry | null }>()
const emit = defineEmits<{ add: [input: NewDiaper]; save: [entry: DiaperEntry]; delete: [id: string] }>()

const when = ref('')
const kind = ref<DiaperKind>('wet')
const stool = ref<StoolColor | undefined>()
const note = ref('')

watch(
  () => [open.value, props.entry] as const,
  ([isOpen, entry]) => {
    if (!isOpen) return
    when.value = toLocalInput(entry?.at ?? Date.now())
    kind.value = entry?.kind ?? 'wet'
    stool.value = entry?.stool
    note.value = entry?.note ?? ''
  },
  { immediate: true },
)

const dirty = computed(() => isDirty({ kind: kind.value }))
const warn = computed(() => dirty.value && isWarnStool(stool.value))

function save() {
  const at = Math.min(fromLocalInput(when.value) ?? Date.now(), Date.now() + 5 * MINUTE)
  const text = note.value.trim()
  const colour = dirty.value ? stool.value : undefined
  if (props.entry) {
    const next: DiaperEntry = { ...props.entry, at, kind: kind.value }
    if (colour) next.stool = colour
    else delete next.stool
    if (text) next.note = text
    else delete next.note
    emit('save', next)
  } else {
    emit('add', { at, kind: kind.value, ...(colour ? { stool: colour } : {}), ...(text ? { note: text } : {}) })
  }
  open.value = false
}

function remove() {
  if (!props.entry) return
  emit('delete', props.entry.id)
  open.value = false
}
</script>

<template>
  <BottomSheet v-model="open" :title="entry ? 'Edit diaper' : 'Log diaper'">
    <form class="stack" :style="{ '--accent': DIAPER_ACCENT }" @submit.prevent="save">
      <div class="field">
        <span>Diaper</span>
        <div class="kinds" role="radiogroup" aria-label="Diaper type">
          <button
            v-for="k in DIAPER_KINDS"
            :key="k"
            type="button"
            role="radio"
            :aria-checked="kind === k"
            class="kind"
            :class="{ active: kind === k }"
            @click="kind = k"
          >
            {{ KIND_LABEL[k] }}
          </button>
        </div>
      </div>

      <div v-if="dirty" class="field">
        <span>Stool colour</span>
        <StoolPicker v-model="stool" />
      </div>
      <p v-if="warn" class="small warn-text">
        Pale, white or bloody stools should be shown to your paediatrician soon — take a photo of the diaper.
      </p>

      <label class="field">
        <span>Changed at</span>
        <input v-model="when" type="datetime-local" class="input" />
      </label>
      <label class="field">
        <span>Note</span>
        <textarea v-model="note" class="input" rows="2" placeholder="Optional — e.g. rash, leaked, very runny" />
      </label>
      <p v-if="entry" class="tiny faint">Logged {{ formatDateTime(entry.createdAt) }}</p>
      <button type="submit" class="btn primary block lg">{{ entry ? 'Save' : 'Log diaper' }}</button>
      <ConfirmButton v-if="entry" label="Delete diaper" confirm-label="Tap again to delete" class="block" @confirm="remove">
        <Trash2 :size="18" />
      </ConfirmButton>
    </form>
  </BottomSheet>
</template>

<style scoped>
.kinds {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.kind {
  min-height: 46px;
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--line);
  font-weight: 800;
  color: var(--text-2);
  transition: all 0.2s;
}

.kind.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.warn-text {
  color: var(--warn);
  font-weight: 700;
}
</style>
