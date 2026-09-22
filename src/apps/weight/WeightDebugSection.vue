<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import JsonView from '@/apps/debug/components/JsonView.vue'
import { getDB } from '@/core/db'
import { formatDateTime } from '@/core/time'
import { readWeightRecords } from './logic/repo'
import { useWeightStore } from './store'

/** Weight tracker internals: store records incl. tombstones, derived stats, settings. */
const store = useWeightStore()
void store.ensureLoaded()

/** Tombstones are invisible to the store but decide what a merge does — show them. */
const records = ref({ total: 0, deleted: 0 })
onMounted(async () => {
  const all = await readWeightRecords(await getDB())
  records.value = { total: all.length, deleted: all.filter((e) => e.deletedAt).length }
})

const stats = computed(() => ({ ...store.stats }))
</script>

<template>
  <table>
    <tbody>
      <tr>
        <th>Weighings in store</th>
        <td>{{ store.weights.length }} live · {{ records.deleted }} tombstoned · {{ records.total }} records</td>
      </tr>
      <tr>
        <th>Birth moment (profile)</th>
        <td>{{ store.birthMs != null ? formatDateTime(store.birthMs) : 'no profile' }}</td>
      </tr>
      <tr>
        <th>Birth weight entry</th>
        <td>
          {{ store.stats.birth ? `${store.stats.birth.grams} g · ${formatDateTime(store.stats.birth.at)}` : 'none within 2 days of birth' }}
        </td>
      </tr>
    </tbody>
  </table>
  <strong class="small">Derived stats</strong>
  <JsonView :value="stats" />
  <strong class="small">Settings (kv: weight.settings)</strong>
  <JsonView :value="store.settings" />
</template>
