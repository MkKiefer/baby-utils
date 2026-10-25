<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarClock, ChevronRight, Info, Pill, Plus } from 'lucide-vue-next'
import { formatShortDate } from '@/core/time'
import { useMedsStore } from '../store'
import { useMedsActions } from '../useMedsActions'
import PlanCard from '../components/PlanCard.vue'
import PlanSheet from '../components/PlanSheet.vue'
import DoseSheet from '../components/DoseSheet.vue'
import { describeSchedule } from '../logic/format'
import { addDays, lastDay } from '../logic/schedule'
import type { MedDose, MedPlan } from '../logic/types'

const store = useMedsStore()
const actions = useMedsActions()
void store.ensureLoaded()

const showEnded = ref(false)
const endedShown = computed(() => (showEnded.value ? store.ended : store.ended.slice(0, 3)))

// Plan sheet
const planOpen = ref(false)
const editingPlan = ref<MedPlan | null>(null)
function newPlan() {
  editingPlan.value = null
  planOpen.value = true
}
function editPlan(plan: MedPlan) {
  editingPlan.value = plan
  planOpen.value = true
}

// Dose sheet
const doseOpen = ref(false)
const editingDose = ref<MedDose | null>(null)
const dosePlanId = ref<string | null>(null)
function doseDetails(plan: MedPlan) {
  editingDose.value = null
  dosePlanId.value = plan.id
  doseOpen.value = true
}
function editDose(id: string) {
  editingDose.value = store.doses.find((d) => d.id === id) ?? null
  dosePlanId.value = editingDose.value?.planId ?? null
  if (editingDose.value) doseOpen.value = true
}

function give(plan: MedPlan) {
  void actions.logDose({ planId: plan.id, at: Date.now() })
}

function endedLabel(plan: MedPlan) {
  if (plan.stoppedAt !== undefined) return `stopped ${formatShortDate(plan.stoppedAt)}`
  const last = lastDay(plan)
  return last ? `finished ${formatShortDate(last)}` : ''
}

const tomorrow = computed(() => addDays(new Date(store.now).setHours(0, 0, 0, 0), 1))
</script>

<template>
  <div class="page stack">
    <template v-if="store.loaded && !store.plans.length">
      <div class="empty card stack">
        <span class="badge"><Pill :size="28" /></span>
        <h2>Keep track of medication</h2>
        <p class="small muted">
          Add a plan — for example <strong>Amoxicillin 2.5 ml, 3 times a day for 7 days</strong> — then tap
          <strong>Given</strong> each time. You will see what is due, what was missed and how far along the course is.
        </p>
        <button class="btn primary block lg" @click="newPlan"><Plus :size="20" /> Add a medication plan</button>
      </div>
    </template>

    <template v-else>
      <PlanCard
        v-for="v in store.active"
        :key="v.plan.id"
        :view="v"
        :now="store.now"
        @give="give(v.plan)"
        @details="doseDetails(v.plan)"
        @edit="editPlan(v.plan)"
        @dose="editDose"
      />
      <p v-if="store.loaded && !store.active.length" class="muted small center">No medication is due today.</p>

      <button class="btn ghost block" @click="newPlan"><Plus :size="18" /> New medication plan</button>

      <template v-if="store.upcoming.length">
        <h2 class="section-title">Starting later</h2>
        <div class="list">
          <button v-for="v in store.upcoming" :key="v.plan.id" class="list-item" @click="editPlan(v.plan)">
            <CalendarClock :size="20" class="faint" />
            <div class="grow">
              <strong>{{ v.plan.name }}</strong>
              <p class="tiny faint">{{ describeSchedule(v.plan) }}</p>
            </div>
            <span class="chip">{{ v.plan.at === tomorrow ? 'tomorrow' : formatShortDate(v.plan.at) }}</span>
          </button>
        </div>
      </template>

      <template v-if="store.ended.length">
        <h2 class="section-title">Finished</h2>
        <div class="list">
          <button v-for="v in endedShown" :key="v.plan.id" class="list-item" @click="editPlan(v.plan)">
            <div class="grow">
              <strong>{{ v.plan.name }}</strong>
              <p class="tiny faint num">
                {{ v.course.planned ? `${v.course.given} of ${v.course.planned}` : v.course.given }} doses ·
                {{ endedLabel(v.plan) }}
              </p>
            </div>
            <ChevronRight :size="18" class="faint" />
          </button>
        </div>
        <button v-if="store.ended.length > 3 && !showEnded" class="btn sm ghost" @click="showEnded = true">
          Show all {{ store.ended.length }}
        </button>
      </template>

      <div class="callout info">
        <Info :size="20" />
        <p>This is a log, not medical advice. Follow the dose and schedule from your doctor or pharmacist.</p>
      </div>
    </template>
  </div>

  <PlanSheet
    v-model="planOpen"
    :plan="editingPlan"
    @create="actions.createPlan"
    @save="actions.savePlan"
    @stop="actions.stopPlan"
    @resume="actions.resumePlan"
    @delete="actions.removePlan"
  />
  <DoseSheet
    v-model="doseOpen"
    :dose="editingDose"
    :plan-id="dosePlanId"
    :plans="store.plans"
    @add="actions.logDose"
    @save="actions.saveDose"
    @delete="actions.removeDose"
  />
</template>

<style scoped>
.empty {
  align-items: center;
  text-align: center;
  padding: 28px 20px;
}

.empty h2 {
  font-size: 20px;
  font-weight: 900;
}

.badge {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 20px;
  background: var(--accent-soft);
  color: var(--accent);
}

.center {
  text-align: center;
}
</style>
