import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import { getDB } from '@/core/db'
import { emitChange, onChange } from '@/core/sync'
import { MINUTE } from '@/core/time'
import {
  addDose,
  addPlan,
  deleteDose,
  deletePlan,
  putDose,
  putPlan,
  readAllDoses,
  readAllPlans,
  restoreDose,
  restorePlan,
  type NewDose,
  type NewPlan,
} from './logic/repo'
import { courseProgress, planDay, planStatus, sortDoses, sortPlans, type Course, type PlanDay, type PlanStatus } from './logic/schedule'
import type { MedDose, MedPlan } from './logic/types'

export interface PlanView {
  plan: MedPlan
  status: PlanStatus
  today: PlanDay
  course: Course
}

export const useMedsStore = defineStore('meds', () => {
  const plans = ref<MedPlan[]>([])
  const doses = ref<MedDose[]>([])
  const loaded = ref(false)

  // "Due", "overdue" and "today" move with the clock, not only with edits.
  const now = ref(Date.now())
  const timer = setInterval(() => (now.value = Date.now()), MINUTE)
  onScopeDispose(() => clearInterval(timer))

  const views = computed<PlanView[]>(() =>
    plans.value.map((plan) => ({
      plan,
      status: planStatus(plan, now.value),
      today: planDay(plan, doses.value, now.value, now.value),
      course: courseProgress(plan, doses.value, now.value),
    })),
  )
  const active = computed(() => views.value.filter((v) => v.status === 'active'))
  const upcoming = computed(() => views.value.filter((v) => v.status === 'upcoming'))
  const ended = computed(() => views.value.filter((v) => v.status === 'finished' || v.status === 'stopped').reverse())

  /** The soonest open dose among active scheduled plans. */
  const nextDue = computed(() => {
    let best: { view: PlanView; at: number } | null = null
    for (const v of active.value) {
      const n = v.today.next
      if (n && !(n.approx && v.today.doses.length === 0) && (!best || n.at < best.at)) best = { view: v, at: n.at }
    }
    return best
  })

  let loading: Promise<void> | null = null

  async function load() {
    const db = await getDB()
    const [p, d] = await Promise.all([readAllPlans(db), readAllDoses(db)])
    plans.value = sortPlans(p)
    doses.value = sortDoses(d)
    loaded.value = true
  }

  function ensureLoaded() {
    loading ??= load()
    return loading
  }

  function touch() {
    now.value = Date.now()
    emitChange('meds')
  }

  const planById = (id: string) => plans.value.find((p) => p.id === id)

  async function createPlan(input: NewPlan) {
    const plan = await addPlan(await getDB(), input)
    plans.value = sortPlans([...plans.value, plan])
    touch()
    return plan
  }

  async function updatePlan(plan: MedPlan) {
    const saved = await putPlan(await getDB(), plan)
    plans.value = sortPlans(plans.value.map((p) => (p.id === saved.id ? saved : p)))
    touch()
    return saved
  }

  async function removePlan(id: string) {
    const removed = await deletePlan(await getDB(), id)
    plans.value = plans.value.filter((p) => p.id !== id)
    doses.value = doses.value.filter((d) => d.planId !== id)
    touch()
    return removed
  }

  async function restorePlanWithDoses(plan: MedPlan, planDoses: MedDose[]) {
    await restorePlan(await getDB(), plan, planDoses)
    await load()
    touch()
  }

  async function logDose(input: NewDose) {
    const dose = await addDose(await getDB(), input)
    doses.value = sortDoses([...doses.value, dose])
    touch()
    return dose
  }

  async function updateDose(dose: MedDose) {
    const saved = await putDose(await getDB(), dose)
    doses.value = sortDoses(doses.value.map((d) => (d.id === saved.id ? saved : d)))
    touch()
    return saved
  }

  async function removeDose(id: string) {
    const dose = doses.value.find((d) => d.id === id)
    await deleteDose(await getDB(), id)
    doses.value = doses.value.filter((d) => d.id !== id)
    touch()
    return dose
  }

  async function restoreDoseEntry(dose: MedDose) {
    const saved = await restoreDose(await getDB(), dose)
    doses.value = sortDoses([...doses.value.filter((d) => d.id !== saved.id), saved])
    touch()
  }

  onChange((e) => {
    if (e.scope === 'all' || (!e.local && e.scope === 'meds')) loading = load()
  })

  return {
    plans,
    doses,
    loaded,
    now,
    views,
    active,
    upcoming,
    ended,
    nextDue,
    ensureLoaded,
    planById,
    createPlan,
    updatePlan,
    removePlan,
    restorePlanWithDoses,
    logDose,
    updateDose,
    removeDose,
    restoreDoseEntry,
  }
})
