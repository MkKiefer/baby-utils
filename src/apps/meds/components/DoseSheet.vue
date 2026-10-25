<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { formatDateTime, fromLocalInput, MINUTE, toLocalInput } from '@/core/time'
import type { NewDose } from '../logic/repo'
import { MEDS_ACCENT, type MedDose, type MedPlan } from '../logic/types'

/**
 * Log a dose with a time and details (`dose` null) or edit one. `planId` preselects the plan;
 * without it the sheet offers every plan to choose from.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ dose: MedDose | null; planId?: string | null; plans: MedPlan[]; at?: number | null }>()
const emit = defineEmits<{ add: [input: NewDose]; save: [dose: MedDose]; delete: [id: string] }>()

const plan = ref('')
const when = ref('')
const state = ref<'given' | 'skipped'>('given')
const note = ref('')

watch(
  () => [open.value, props.dose] as const,
  ([isOpen, dose]) => {
    if (!isOpen) return
    plan.value = dose?.planId ?? props.planId ?? props.plans[0]?.id ?? ''
    when.value = toLocalInput(dose?.at ?? props.at ?? Date.now())
    state.value = dose?.skipped ? 'skipped' : 'given'
    note.value = dose?.note ?? ''
  },
  { immediate: true },
)

const current = computed(() => props.plans.find((p) => p.id === plan.value))
const title = computed(() => {
  if (props.dose) return 'Edit dose'
  return current.value && props.planId ? `Log ${current.value.name}` : 'Log dose'
})

function save() {
  if (!plan.value) return
  const at = Math.min(fromLocalInput(when.value) ?? Date.now(), Date.now() + 5 * MINUTE)
  const text = note.value.trim()
  const skipped = state.value === 'skipped'
  if (props.dose) {
    const next: MedDose = { ...props.dose, at, planId: plan.value }
    if (skipped) next.skipped = true
    else delete next.skipped
    if (text) next.note = text
    else delete next.note
    emit('save', next)
  } else {
    emit('add', { planId: plan.value, at, ...(skipped ? { skipped } : {}), ...(text ? { note: text } : {}) })
  }
  open.value = false
}

function remove() {
  if (!props.dose) return
  emit('delete', props.dose.id)
  open.value = false
}
</script>

<template>
  <BottomSheet v-model="open" :title="title">
    <form class="stack" :style="{ '--accent': MEDS_ACCENT }" @submit.prevent="save">
      <div v-if="!planId && plans.length > 1" class="field">
        <span>Medication</span>
        <div class="plans" role="radiogroup" aria-label="Medication">
          <button
            v-for="p in plans"
            :key="p.id"
            type="button"
            role="radio"
            :aria-checked="plan === p.id"
            class="plan"
            :class="{ active: plan === p.id }"
            @click="plan = p.id"
          >
            {{ p.name }}<span v-if="p.dose" class="tiny muted"> · {{ p.dose }}</span>
          </button>
        </div>
      </div>
      <p v-else-if="current" class="small muted">
        <strong>{{ current.name }}</strong><template v-if="current.dose"> · {{ current.dose }}</template>
      </p>

      <SegmentedControl
        v-model="state"
        label="Given or skipped"
        :options="[
          { value: 'given', label: 'Given' },
          { value: 'skipped', label: 'Skipped' },
        ]"
      />

      <label class="field">
        <span>{{ state === 'given' ? 'Given at' : 'Planned for' }}</span>
        <input v-model="when" type="datetime-local" class="input" />
      </label>
      <label class="field">
        <span>Note</span>
        <textarea v-model="note" class="input" rows="2" placeholder="Optional — e.g. spat some out, half dose" />
      </label>
      <p v-if="dose" class="tiny faint">Logged {{ formatDateTime(dose.createdAt) }}</p>
      <button type="submit" class="btn primary block lg" :disabled="!plan">{{ dose ? 'Save' : 'Log dose' }}</button>
      <ConfirmButton v-if="dose" label="Delete dose" confirm-label="Tap again to delete" class="block" @confirm="remove">
        <Trash2 :size="18" />
      </ConfirmButton>
    </form>
  </BottomSheet>
</template>

<style scoped>
.plans {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plan {
  min-height: 42px;
  padding: 0 14px;
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--line);
  font-weight: 800;
  color: var(--text-2);
  transition: all 0.2s;
}

.plan.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}
</style>
