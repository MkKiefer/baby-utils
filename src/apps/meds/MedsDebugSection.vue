<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import JsonView from '@/apps/debug/components/JsonView.vue'
import { getDB } from '@/core/db'
import { formatDateTime } from '@/core/time'
import { medsNotificationProvider, readDoseRecords, readPlanRecords } from './logic/repo'
import { planTimes } from './logic/schedule'
import { useMedsStore } from './store'

/** Medication internals: records incl. tombstones, per-plan schedule state, planned reminders. */
const store = useMedsStore()
void store.ensureLoaded()

const records = ref({ plans: 0, plansDeleted: 0, doses: 0, dosesDeleted: 0 })
const reminders = ref<unknown>(null)

async function refresh() {
  const db = await getDB()
  const [plans, doses] = await Promise.all([readPlanRecords(db), readDoseRecords(db)])
  records.value = {
    plans: plans.length,
    plansDeleted: plans.filter((p) => p.deletedAt).length,
    doses: doses.length,
    dosesDeleted: doses.filter((d) => d.deletedAt).length,
  }
  const planned = await medsNotificationProvider.plan(db, Date.now())
  reminders.value = {
    badge: planned.badge,
    notifications: planned.notifications.map((n) => ({ id: n.id, at: formatDateTime(n.at), title: n.title, body: n.body })),
  }
}
onMounted(refresh)

const perPlan = computed(() =>
  store.views.map((v) => ({
    id: v.plan.id,
    name: v.plan.name,
    status: v.status,
    fixedTimes: planTimes(v.plan),
    today: {
      doseDay: v.today.doseDay,
      expected: v.today.expected,
      given: v.today.given,
      skipped: v.today.skipped,
      done: v.today.done,
      next: v.today.next && { ...v.today.next, at: formatDateTime(v.today.next.at) },
    },
    course: v.course,
  })),
)
</script>

<template>
  <table>
    <tbody>
      <tr>
        <th>Plans in store</th>
        <td>{{ store.plans.length }} live · {{ records.plansDeleted }} tombstoned · {{ records.plans }} records</td>
      </tr>
      <tr>
        <th>Doses in store</th>
        <td>{{ store.doses.length }} live · {{ records.dosesDeleted }} tombstoned · {{ records.doses }} records</td>
      </tr>
      <tr>
        <th>Clock used for "today"</th>
        <td>{{ formatDateTime(store.now) }}</td>
      </tr>
    </tbody>
  </table>
  <strong class="small">Plans, as of now</strong>
  <JsonView :value="perPlan" />
  <div class="row">
    <strong class="small">Planned reminders (provider output)</strong>
    <span class="spacer" />
    <button class="btn sm" @click="refresh">Refresh</button>
  </div>
  <JsonView :value="reminders" />
</template>
