<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import JsonView from '@/apps/debug/components/JsonView.vue'
import { formatClock, formatDateTime, formatDuration, formatOffset } from '@/core/time'
import { getDB } from '@/core/db'
import { readLastMerge, type LastMerge } from '@/core/merge'
import { readFeedRecords } from './logic/repo'
import { useFeedStore } from './store'

/** Feed timer internals: interval resolution, rhythm samples, reminder cycles. */
const store = useFeedStore()
void store.ensureLoaded()

/** Tombstones are invisible to the store but decide what a merge does — show them. */
const records = ref({ total: 0, deleted: 0 })
const lastMerge = ref<LastMerge | null>(null)

onMounted(async () => {
  const all = await readFeedRecords(await getDB())
  records.value = { total: all.length, deleted: all.filter((e) => e.deletedAt).length }
  lastMerge.value = await readLastMerge()
})

const plan = computed(() => store.plan)
const summary = computed(() => {
  const p = plan.value
  return {
    status: p.status,
    ageDays: p.ageDays,
    interval: p.interval,
    offsetMin: p.offsetMin,
    totalMin: p.totalMin,
    unanswered: p.unanswered,
    remindersEnabled: p.remindersEnabled,
    lastFeed: p.lastFeed,
    rhythm: { state: p.rhythm.state, medianMin: p.rhythm.medianMin, bounds: p.rhythm.bounds, usedCount: p.rhythm.usedCount },
  }
})
</script>

<template>
  <table>
    <tbody>
      <tr>
        <th>Status</th>
        <td>
          <b>{{ plan.status }}</b>
        </td>
      </tr>
      <tr>
        <th>Interval</th>
        <td>
          {{ formatDuration(plan.baseMin) }} ({{ plan.interval.source }}, age table {{ formatDuration(plan.interval.ageMin) }}{{
            plan.interval.jaundiceCapped ? ', jaundice cap' : ''
          }}) {{ formatOffset(plan.offsetMin) }} rhythm = {{ formatDuration(plan.totalMin) }}
        </td>
      </tr>
      <tr>
        <th>Feeds in store</th>
        <td>{{ store.feeds.length }} live · {{ records.deleted }} tombstoned · {{ records.total }} records</td>
      </tr>
      <tr>
        <th>Last merge</th>
        <td>
          <template v-if="lastMerge">
            {{ formatDateTime(lastMerge.at) }} · from
            {{ lastMerge.via === 'cloud' ? 'relay sync sent' : lastMerge.via === 'nearby' ? 'a nearby sync code of' : 'a backup of' }} {{ formatDateTime(lastMerge.from) }}
          </template>
          <template v-else>never</template>
        </td>
      </tr>
    </tbody>
  </table>

  <strong class="small">Reminder cycles</strong>
  <table>
    <tbody>
      <tr v-for="c in plan.cycles" :key="c.index">
        <th>Cycle {{ c.index }}</th>
        <td>start {{ formatClock(c.startAt) }} · age {{ formatClock(c.baseAt) }} · due {{ formatClock(c.dueAt) }}</td>
      </tr>
    </tbody>
  </table>

  <strong class="small">Rhythm samples (newest first)</strong>
  <table>
    <thead>
      <tr>
        <th style="width: auto">Interval</th>
        <th style="width: auto">Actual</th>
        <th style="width: auto">Planned</th>
        <th style="width: auto">Δ</th>
        <th style="width: auto">Used</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="s in plan.rhythm.samples" :key="s.toAt">
        <td>{{ formatClock(s.fromAt) }}→{{ formatClock(s.toAt) }}</td>
        <td>{{ formatDuration(s.actualMin) }}</td>
        <td>{{ formatDuration(s.plannedMin) }}</td>
        <td>{{ formatOffset(Math.round(s.deltaMin)) }}</td>
        <td>{{ s.used ? 'yes' : s.excluded }}</td>
      </tr>
    </tbody>
  </table>

  <strong class="small">Planned notifications</strong>
  <JsonView :value="plan.notifications" />
  <strong class="small">Plan summary</strong>
  <JsonView :value="summary" />
  <strong class="small">Settings (kv: feed.settings)</strong>
  <JsonView :value="store.settings" />
  <strong class="small">Last merge (kv: merge.last)</strong>
  <JsonView :value="lastMerge" />
</template>
