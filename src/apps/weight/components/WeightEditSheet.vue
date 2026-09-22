<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import { formatDateTime, fromLocalInput, MINUTE, toLocalInput } from '@/core/time'
import { formatChange, formatWeight, gramsFromKg, gramsFromLbOz, toLbOz } from '../logic/format'
import { MAX_GRAMS, MIN_GRAMS, WEIGHT_ACCENT, type WeightEntry, type WeightUnit } from '../logic/types'
import type { NewWeight } from '../logic/repo'

/** Add a weighing (`entry` null) or edit one. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ entry: WeightEntry | null; unit: WeightUnit; previous?: WeightEntry | null }>()
const emit = defineEmits<{ add: [input: NewWeight]; save: [entry: WeightEntry]; delete: [id: string] }>()

const when = ref('')
const kg = ref('')
const lb = ref('')
const oz = ref('')
const note = ref('')
const firstInput = ref<HTMLInputElement | null>(null)

watch(
  () => [open.value, props.entry] as const,
  ([isOpen, entry]) => {
    if (!isOpen) return
    when.value = toLocalInput(entry?.at ?? Date.now())
    note.value = entry?.note ?? ''
    if (entry) {
      kg.value = (entry.grams / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
      const parts = toLbOz(entry.grams)
      lb.value = String(parts.lb)
      oz.value = String(parts.oz)
    } else {
      kg.value = lb.value = oz.value = ''
      void nextTick(() => firstInput.value?.focus())
    }
  },
  { immediate: true },
)

const grams = computed(() => (props.unit === 'kg' ? gramsFromKg(kg.value) : gramsFromLbOz(lb.value, oz.value)))
const error = computed(() => {
  const g = grams.value
  if (g == null) return null
  if (g < MIN_GRAMS || g > MAX_GRAMS) return `That looks off — expected between ${formatWeight(MIN_GRAMS, props.unit)} and ${formatWeight(MAX_GRAMS, props.unit)}.`
  return null
})
const valid = computed(() => grams.value != null && !error.value)
/** Live preview against the weighing before this one, so a typo stands out. */
const preview = computed(() => {
  const g = grams.value
  if (g == null || error.value) return null
  const prev = props.previous
  return prev ? `${formatWeight(g, props.unit)} · ${formatChange(g - prev.grams, props.unit)} vs ${formatDateTime(prev.at)}` : formatWeight(g, props.unit)
})

function save() {
  const g = grams.value
  if (g == null || !valid.value) return
  const at = Math.min(fromLocalInput(when.value) ?? Date.now(), Date.now() + 5 * MINUTE)
  const text = note.value.trim()
  if (props.entry) {
    const next: WeightEntry = { ...props.entry, at, grams: g }
    if (text) next.note = text
    else delete next.note
    emit('save', next)
  } else {
    emit('add', { at, grams: g, ...(text ? { note: text } : {}) })
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
  <BottomSheet v-model="open" :title="entry ? 'Edit weighing' : 'Log weight'">
    <form class="stack" :style="{ '--accent': WEIGHT_ACCENT }" @submit.prevent="save">
      <div v-if="unit === 'kg'" class="field">
        <span>Weight</span>
        <div class="unit-input">
          <input
            ref="firstInput"
            v-model="kg"
            class="input num big"
            inputmode="decimal"
            placeholder="3.450"
            aria-label="Weight in kilograms"
            autocomplete="off"
          />
          <span class="suffix">kg</span>
        </div>
      </div>
      <div v-else class="field">
        <span>Weight</span>
        <div class="row" style="gap: 8px">
          <div class="unit-input">
            <input ref="firstInput" v-model="lb" class="input num big" inputmode="numeric" placeholder="7" aria-label="Pounds" autocomplete="off" />
            <span class="suffix">lb</span>
          </div>
          <div class="unit-input">
            <input v-model="oz" class="input num big" inputmode="decimal" placeholder="9.5" aria-label="Ounces" autocomplete="off" />
            <span class="suffix">oz</span>
          </div>
        </div>
      </div>
      <p v-if="error" class="small warn-text">{{ error }}</p>
      <p v-else-if="preview" class="small muted num">{{ preview }}</p>

      <label class="field">
        <span>Weighed at</span>
        <input v-model="when" type="datetime-local" class="input" />
      </label>
      <label class="field">
        <span>Note</span>
        <textarea v-model="note" class="input" rows="2" placeholder="Optional — e.g. midwife visit, with clothes" />
      </label>
      <p v-if="entry" class="tiny faint">Logged {{ formatDateTime(entry.createdAt) }}</p>
      <button type="submit" class="btn primary block lg" :disabled="!valid">{{ entry ? 'Save' : 'Log weight' }}</button>
      <ConfirmButton v-if="entry" label="Delete weighing" confirm-label="Tap again to delete" class="block" @confirm="remove">
        <Trash2 :size="18" />
      </ConfirmButton>
    </form>
  </BottomSheet>
</template>

<style scoped>
.unit-input {
  position: relative;
  flex: 1;
}

.unit-input .input {
  width: 100%;
  padding-right: 48px;
}

.big {
  font-size: 24px;
  font-weight: 900;
}

.suffix {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-weight: 800;
  color: var(--text-2);
  pointer-events: none;
}

.warn-text {
  color: var(--warn);
  font-weight: 700;
}
</style>
