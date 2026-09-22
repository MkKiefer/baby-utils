<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getDB } from '@/core/db'
import { collectPlan, GRACE_MS, STALE_MS } from '@/core/notify/engine'
import { notificationPermission, requestNotificationPermission } from '@/core/notify/permission'
import { refreshSchedule, schedulerState, showNotification } from '@/core/notify/scheduler'
import type { NotifLogEntry, PlannedNotification } from '@/core/notify/types'
import { formatDateTime } from '@/core/time'
import ConfirmButton from '@/components/ConfirmButton.vue'
import JsonView from '../components/JsonView.vue'

const planned = ref<PlannedNotification[]>([])
const log = ref<NotifLogEntry[]>([])
const displayed = ref<{ title: string; body: string; tag: string; data: unknown }[]>([])
const planErrors = ref<unknown[]>([])
const testCountdown = ref(0)

async function refresh() {
  const db = await getDB()
  const plan = await collectPlan(db, Date.now())
  planned.value = plan.notifications
  planErrors.value = plan.errors
  log.value = (await db.getAllFromIndex('notifLog', 'byFiredAt')).reverse().slice(0, 50)
  const reg = await navigator.serviceWorker?.getRegistration()
  const shown = (await reg?.getNotifications()) ?? []
  displayed.value = shown.map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data }))
}

async function clearLog() {
  const db = await getDB()
  await db.clear('notifLog')
  await refreshSchedule()
  await refresh()
}

async function closeDisplayed() {
  const reg = await navigator.serviceWorker?.getRegistration()
  ;(await reg?.getNotifications())?.forEach((n) => n.close())
  await refresh()
}

async function test(delaySec: number) {
  if (notificationPermission.value !== 'granted') await requestNotificationPermission()
  testCountdown.value = delaySec
  const tick = setInterval(() => (testCountdown.value = Math.max(0, testCountdown.value - 1)), 1000)
  setTimeout(async () => {
    clearInterval(tick)
    await showNotification({
      id: `debug:${Date.now()}`,
      at: Date.now(),
      title: 'Debug notification',
      body: `Shown after ${delaySec}s via ${navigator.serviceWorker?.controller ? 'service worker registration' : 'Notification()'}`,
      tag: 'debug',
      source: 'debug',
      kind: 'test',
      url: '/app/debug',
      actions: [{ action: 'feed-fed', title: 'Fed now (logs a feed!)' }],
    })
    await refresh()
  }, delaySec * 1000)
}

const fmt = (ms: number | null) => (ms ? formatDateTime(ms) : '—')

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <table>
    <tbody>
      <tr>
        <th>Permission</th>
        <td>
          <b>{{ notificationPermission }}</b>
        </td>
      </tr>
      <tr>
        <th>Scheduler</th>
        <td>
          {{ schedulerState.running ? 'running' : 'stopped' }} · {{ schedulerState.runs }} runs · last {{ fmt(schedulerState.lastRunAt) }}
        </td>
      </tr>
      <tr>
        <th>Next planned</th>
        <td>{{ fmt(schedulerState.nextAt) }} {{ schedulerState.nextTitle }}</td>
      </tr>
      <tr>
        <th>Badge</th>
        <td>{{ schedulerState.badge }} ({{ schedulerState.badgeStatus || '—' }})</td>
      </tr>
      <tr>
        <th>Rules</th>
        <td>show if late ≤ {{ GRACE_MS / 60000 }}m, or ≤ {{ STALE_MS / 60000 }}m while the app is hidden; same tag → only newest</td>
      </tr>
    </tbody>
  </table>
  <JsonView v-if="schedulerState.errors.length || planErrors.length" :value="{ scheduler: schedulerState.errors, plan: planErrors }" />

  <div class="row" style="flex-wrap: wrap">
    <button class="btn sm" @click="requestNotificationPermission">Request permission</button>
    <button class="btn sm" @click="test(0)">Test now</button>
    <button class="btn sm" :disabled="testCountdown > 0" @click="test(10)">
      {{ testCountdown ? `in ${testCountdown}s…` : 'Test in 10s' }}
    </button>
    <button class="btn sm" @click="refreshSchedule().then(refresh)">Run scheduler</button>
  </div>

  <strong class="small">Upcoming plan ({{ planned.length }})</strong>
  <table v-if="planned.length">
    <tbody>
      <tr v-for="n in planned" :key="n.id">
        <th>{{ fmt(n.at) }}</th>
        <td>
          <b>{{ n.title }}</b> <span class="faint">[{{ n.source }}/{{ n.kind }}]</span><br />
          <code class="tiny">{{ n.id }}</code>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-else class="tiny faint">Nothing planned.</p>

  <strong class="small">Currently displayed ({{ displayed.length }})</strong>
  <JsonView v-if="displayed.length" :value="displayed" />
  <button v-if="displayed.length" class="btn sm" @click="closeDisplayed">Close all</button>

  <strong class="small">Log (IndexedDB notifLog, newest 50)</strong>
  <table v-if="log.length">
    <tbody>
      <tr v-for="l in log" :key="l.id">
        <th>{{ fmt(l.firedAt) }}</th>
        <td>
          <b :class="l.status">{{ l.status }}</b>{{ l.reason ? ` (${l.reason})` : '' }} via {{ l.via }} — {{ l.title }}<br />
          <span class="tiny faint">planned {{ fmt(l.at) }}</span>
        </td>
      </tr>
    </tbody>
  </table>
  <p v-else class="tiny faint">Empty.</p>
  <ConfirmButton label="Clear log (re-arms reminders)" class="sm" @confirm="clearLog" />
</template>

<style scoped>
.shown {
  color: var(--ok);
}

.skipped {
  color: var(--text-3);
}

.failed {
  color: var(--warn);
}
</style>
