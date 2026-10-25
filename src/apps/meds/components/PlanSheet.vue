<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Minus, Pause, Play, Plus, Trash2 } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ToggleSwitch from '@/components/ToggleSwitch.vue'
import { parseLocalDate, toIsoDate } from '@/core/age'
import { formatShortDate } from '@/core/time'
import type { NewPlan } from '../logic/repo'
import { addDays, defaultTimes, planStatus } from '../logic/schedule'
import { MAX_TIMES_PER_DAY, MEDS_ACCENT, type MedPlan } from '../logic/types'
import { describeSchedule } from '../logic/format'

/** Create a medication plan (`plan` null) or edit one. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ plan: MedPlan | null }>()
const emit = defineEmits<{
  create: [input: NewPlan]
  save: [plan: MedPlan]
  stop: [plan: MedPlan]
  resume: [plan: MedPlan]
  delete: [id: string]
}>()

const name = ref('')
const dose = ref('')
const mode = ref<'scheduled' | 'asNeeded'>('scheduled')
const timesPerDay = ref(3)
const everyDays = ref(1)
const start = ref('')
const length = ref<'days' | 'ongoing'>('days')
const days = ref(5)
const fixed = ref(false)
const times = ref<string[]>([])
const remind = ref(false)
const note = ref('')

watch(
  () => [open.value, props.plan] as const,
  ([isOpen, plan]) => {
    if (!isOpen) return
    name.value = plan?.name ?? ''
    dose.value = plan?.dose ?? ''
    mode.value = plan?.asNeeded ? 'asNeeded' : 'scheduled'
    timesPerDay.value = plan?.timesPerDay ?? 3
    everyDays.value = plan?.everyDays ?? 1
    start.value = toIsoDate(new Date(plan?.at ?? Date.now()))
    length.value = plan && !plan.days ? 'ongoing' : 'days'
    days.value = plan?.days ?? 5
    fixed.value = !!plan?.times?.length
    times.value = plan?.times?.length ? [...plan.times] : defaultTimes(timesPerDay.value)
    remind.value = !!plan?.remind
    note.value = plan?.note ?? ''
  },
  { immediate: true },
)

// Keep one time per dose: fresh defaults when the count changes.
watch(timesPerDay, (n) => {
  if (times.value.length !== n) times.value = defaultTimes(n)
})
watch(fixed, (on) => {
  if (!on) remind.value = false
})

function step(delta: number) {
  timesPerDay.value = Math.min(MAX_TIMES_PER_DAY, Math.max(1, timesPerDay.value + delta))
}

const scheduled = computed(() => mode.value === 'scheduled')
const startMs = computed(() => (start.value ? parseLocalDate(start.value).getTime() : Date.now()))
const validDays = computed(() => Math.max(1, Math.min(365, Math.round(Number(days.value) || 1))))

const draft = computed<NewPlan>(() => {
  const out: NewPlan = {
    name: name.value.trim(),
    at: startMs.value,
    timesPerDay: timesPerDay.value,
    everyDays: scheduled.value ? everyDays.value : 1,
  }
  if (dose.value.trim()) out.dose = dose.value.trim()
  if (!scheduled.value) out.asNeeded = true
  if (length.value === 'days') out.days = validDays.value
  if (scheduled.value && fixed.value) {
    out.times = [...times.value].sort()
    if (remind.value) out.remind = true
  }
  if (note.value.trim()) out.note = note.value.trim()
  return out
})

const summary = computed(() => {
  const d = draft.value
  const parts = [describeSchedule(d)]
  if (d.days) parts.push(`until ${formatShortDate(addDays(d.at, d.days - 1))}`)
  return parts.join(' · ')
})

const canSave = computed(() => !!draft.value.name)
const status = computed(() => (props.plan ? planStatus(props.plan, Date.now()) : null))

function save() {
  if (!canSave.value) return
  if (props.plan) {
    // Keep what the form does not edit (id, stop, timestamps); drop fields it cleared.
    const { dose: _d, asNeeded: _a, days: _n, times: _t, remind: _r, note: _o, ...base } = props.plan
    emit('save', { ...base, ...draft.value })
  } else {
    emit('create', draft.value)
  }
  open.value = false
}

function stop() {
  if (props.plan) emit('stop', props.plan)
  open.value = false
}

function resume() {
  if (props.plan) emit('resume', props.plan)
  open.value = false
}

function remove() {
  if (props.plan) emit('delete', props.plan.id)
  open.value = false
}

const everyOptions = [
  { value: 1, label: 'Daily' },
  { value: 2, label: '2nd day' },
  { value: 3, label: '3rd day' },
  { value: 7, label: 'Weekly' },
]
</script>

<template>
  <BottomSheet v-model="open" :title="plan ? 'Edit plan' : 'New medication plan'">
    <form class="stack" :style="{ '--accent': MEDS_ACCENT }" @submit.prevent="save">
      <label class="field">
        <span>Medication</span>
        <input v-model="name" class="input" placeholder="e.g. Amoxicillin, Vitamin D" autocomplete="off" required />
      </label>
      <label class="field">
        <span>Amount per dose</span>
        <input v-model="dose" class="input" placeholder="Optional — e.g. 2.5 ml, 1 drop" autocomplete="off" />
      </label>

      <SegmentedControl
        v-model="mode"
        label="Kind of plan"
        :options="[
          { value: 'scheduled', label: 'On a schedule' },
          { value: 'asNeeded', label: 'As needed' },
        ]"
      />

      <div class="field">
        <span>{{ scheduled ? 'Times a day' : 'At most, per day' }}</span>
        <div class="stepper">
          <button type="button" class="btn" aria-label="Fewer" :disabled="timesPerDay <= 1" @click="step(-1)">
            <Minus :size="18" />
          </button>
          <strong class="num">{{ timesPerDay }}×</strong>
          <button
            type="button"
            class="btn"
            aria-label="More"
            :disabled="timesPerDay >= MAX_TIMES_PER_DAY"
            @click="step(1)"
          >
            <Plus :size="18" />
          </button>
        </div>
      </div>

      <div v-if="scheduled" class="field">
        <span>Repeat</span>
        <SegmentedControl v-model="everyDays" label="Repeat" :options="everyOptions" />
      </div>

      <label class="field">
        <span>First day</span>
        <input v-model="start" type="date" class="input" required />
      </label>

      <div class="field">
        <span>How long</span>
        <SegmentedControl
          v-model="length"
          label="How long"
          :options="[
            { value: 'days', label: 'Number of days' },
            { value: 'ongoing', label: 'Ongoing' },
          ]"
        />
      </div>
      <label v-if="length === 'days'" class="field">
        <span>Days</span>
        <input v-model.number="days" type="number" min="1" max="365" inputmode="numeric" class="input" />
      </label>

      <template v-if="scheduled">
        <div class="row toggle">
          <span class="grow"><strong>Fixed times</strong><br /><span class="small muted">Shows when each dose is due</span></span>
          <ToggleSwitch v-model="fixed" label="Fixed times" />
        </div>
        <div v-if="fixed" class="times">
          <input
            v-for="(_, i) in times"
            :key="i"
            v-model="times[i]"
            type="time"
            class="input"
            :aria-label="`Time of dose ${i + 1}`"
            required
          />
        </div>
        <div v-if="fixed" class="row toggle">
          <span class="grow"><strong>Remind me</strong><br /><span class="small muted">A notification at each time</span></span>
          <ToggleSwitch v-model="remind" label="Remind me" />
        </div>
      </template>

      <label class="field">
        <span>Note</span>
        <textarea v-model="note" class="input" rows="2" placeholder="Optional — e.g. with food, prescribed by…" />
      </label>

      <p class="small muted summary">{{ summary }}</p>

      <button type="submit" class="btn primary block lg" :disabled="!canSave">{{ plan ? 'Save' : 'Add plan' }}</button>
      <template v-if="plan">
        <button v-if="status === 'stopped'" type="button" class="btn block" @click="resume"><Play :size="18" /> Resume plan</button>
        <button v-else-if="status !== 'finished'" type="button" class="btn block" @click="stop">
          <Pause :size="18" /> Stop plan now
        </button>
        <ConfirmButton label="Delete plan and its doses" confirm-label="Tap again to delete" class="block" @confirm="remove">
          <Trash2 :size="18" />
        </ConfirmButton>
      </template>
    </form>
  </BottomSheet>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stepper .btn {
  width: 48px;
  padding: 0;
}

.stepper strong {
  min-width: 48px;
  text-align: center;
  font-size: 22px;
  font-weight: 900;
}

.times {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}

.toggle {
  padding: 4px 4px;
}

.toggle .grow {
  flex: 1;
  min-width: 0;
}

.summary {
  text-align: center;
}
</style>
