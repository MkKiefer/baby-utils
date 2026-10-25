<script setup lang="ts">
import { computed } from 'vue'
import { Bell, Check, Clock, Pencil, StickyNote, X } from 'lucide-vue-next'
import { formatClock, formatSpan } from '@/core/time'
import type { PlanView } from '../store'
import { describeSchedule } from '../logic/format'

/** One active plan on the overview: today's doses, what is next, the course so far. */
const props = defineProps<{ view: PlanView; now: number }>()
const emit = defineEmits<{ give: []; details: []; edit: []; dose: [id: string] }>()

const plan = computed(() => props.view.plan)
const today = computed(() => props.view.today)
const course = computed(() => props.view.course)

const nextText = computed(() => {
  const t = today.value
  if (!t.doseDay) return { text: 'No dose today', tone: 'muted' }
  if (plan.value.asNeeded) {
    const left = t.expected - t.given
    return left > 0
      ? { text: `${t.given} of max ${t.expected} today`, tone: 'muted' }
      : { text: `Daily maximum of ${t.expected} reached`, tone: 'warn' }
  }
  if (t.done) {
    return t.missed
      ? { text: `Done for today · ${t.missed} missed`, tone: 'warn' }
      : { text: 'All done for today', tone: 'ok' }
  }
  const n = t.next
  if (!n) return { text: '', tone: 'muted' }
  if (n.approx) {
    if (!t.doses.length) return { text: 'First dose any time today', tone: 'muted' }
    return n.at <= props.now
      ? { text: `Next due — last ${formatSpan(props.now - t.doses.at(-1)!.at)} ago`, tone: 'accent' }
      : { text: `Next ~${formatClock(n.at)} (in ${formatSpan(n.at - props.now)})`, tone: 'muted' }
  }
  if (n.overdue) return { text: `${formatClock(n.at)} dose overdue by ${formatSpan(props.now - n.at)}`, tone: 'warn' }
  if (n.at <= props.now) return { text: `${formatClock(n.at)} dose due now`, tone: 'accent' }
  return { text: `Next at ${formatClock(n.at)} (in ${formatSpan(n.at - props.now)})`, tone: 'muted' }
})

const progress = computed(() => {
  const c = course.value
  const parts: string[] = []
  if (c.totalDays && c.dayNumber) parts.push(`Day ${Math.min(c.dayNumber, c.totalDays)} of ${c.totalDays}`)
  else if (c.dayNumber) parts.push(`Day ${c.dayNumber}`)
  parts.push(c.planned ? `${c.given} of ${c.planned} doses` : `${c.given} ${c.given === 1 ? 'dose' : 'doses'} given`)
  if (c.skipped) parts.push(`${c.skipped} skipped`)
  return parts.join(' · ')
})
const ratio = computed(() => (course.value.planned ? Math.min(1, course.value.given / course.value.planned) : null))
const canGive = computed(() => today.value.doseDay && !(plan.value.asNeeded && today.value.given >= today.value.expected))
</script>

<template>
  <section class="card stack plan-card">
    <div class="row head">
      <div class="grow">
        <h3>{{ plan.name }}<span v-if="plan.dose" class="muted dose"> · {{ plan.dose }}</span></h3>
        <p class="tiny faint">
          {{ describeSchedule(plan) }}
          <Bell v-if="plan.remind" :size="11" aria-label="Reminders on" />
        </p>
      </div>
      <button class="icon-btn" aria-label="Edit plan" @click="emit('edit')"><Pencil :size="18" /></button>
    </div>

    <div v-if="today.slots.length" class="slots">
      <button
        v-for="(slot, i) in today.slots"
        :key="i"
        type="button"
        class="slot num"
        :class="{
          given: slot.dose && !slot.dose.skipped,
          skipped: slot.dose?.skipped,
          missed: slot.missed,
          next: !slot.dose && !!today.next && slot.at === today.next.at,
        }"
        :title="slot.dose ? 'Edit dose' : slot.missed ? 'Missed' : 'Not given yet'"
        :disabled="!slot.dose"
        @click="slot.dose && emit('dose', slot.dose.id)"
      >
        <Check v-if="slot.dose && !slot.dose.skipped" :size="14" />
        <X v-else-if="slot.dose?.skipped" :size="14" />
        <span v-if="slot.dose">{{ formatClock(slot.dose.at) }}</span>
        <span v-else-if="slot.at">{{ formatClock(slot.at) }}</span>
        <span v-else>{{ i + 1 }}</span>
      </button>
    </div>

    <p class="small next" :class="nextText.tone">{{ nextText.text }}</p>

    <div class="actions">
      <button class="btn primary" :disabled="!canGive" @click="emit('give')"><Check :size="18" /> Given now</button>
      <button class="btn ghost" @click="emit('details')"><Clock :size="18" /> Earlier / skip…</button>
    </div>

    <div class="course">
      <div v-if="ratio !== null" class="bar"><i :style="{ width: `${ratio * 100}%` }" /></div>
      <p class="tiny faint num">{{ progress }}</p>
    </div>
    <p v-if="plan.note" class="tiny faint"><StickyNote :size="11" /> {{ plan.note }}</p>
  </section>
</template>

<style scoped>
.plan-card {
  gap: 10px;
}

.head {
  align-items: flex-start;
}

.grow {
  flex: 1;
  min-width: 0;
}

h3 {
  font-size: 17px;
  font-weight: 900;
}

.dose {
  font-weight: 700;
  font-size: 15px;
}

.slots {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.slot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-3);
  background: var(--surface-2);
  border: 1.5px dashed var(--line-2);
}

.slot:disabled {
  opacity: 1;
  cursor: default;
}

.slot.next {
  border-color: var(--accent);
  color: var(--text-2);
}

.slot.given {
  border-style: solid;
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--text);
}

.slot.missed {
  border-style: solid;
  border-color: color-mix(in oklab, var(--warn) 45%, transparent);
  color: var(--warn);
  text-decoration: line-through;
}

.slot.skipped {
  border-style: solid;
  color: var(--text-3);
  text-decoration: line-through;
}

.next {
  font-weight: 700;
}

.next.muted {
  color: var(--text-2);
}

.next.ok {
  color: var(--ok);
}

.next.warn {
  color: var(--warn);
}

.next.accent {
  color: var(--accent);
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.actions .btn {
  padding: 0 10px;
}

.course {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.3s var(--ease);
}
</style>
