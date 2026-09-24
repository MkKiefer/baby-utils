<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import JsonView from '@/apps/debug/components/JsonView.vue'
import { getDB } from '@/core/db'
import { formatDateTime } from '@/core/time'
import { readDiaperRecords } from './logic/repo'
import { useDiaperStore } from './store'

/** Diaper log internals: store records incl. tombstones, derived stats, age guide. */
const store = useDiaperStore()
void store.ensureLoaded()

/** Tombstones are invisible to the store but decide what a merge does — show them. */
const records = ref({ total: 0, deleted: 0 })
onMounted(async () => {
  const all = await readDiaperRecords(await getDB())
  records.value = { total: all.length, deleted: all.filter((e) => e.deletedAt).length }
})

const stats = computed(() => ({ ...store.stats }))
</script>

<template>
  <table>
    <tbody>
      <tr>
        <th>Diapers in store</th>
        <td>{{ store.diapers.length }} live · {{ records.deleted }} tombstoned · {{ records.total }} records</td>
      </tr>
      <tr>
        <th>Clock used for "today"</th>
        <td>{{ formatDateTime(store.now) }}</td>
      </tr>
      <tr>
        <th>Age guide (per day)</th>
        <td>{{ store.expected ? `${store.expected.wet}+ wet · ${store.expected.dirty ?? '—'} dirty` : 'no profile' }}</td>
      </tr>
    </tbody>
  </table>
  <strong class="small">Derived stats</strong>
  <JsonView :value="stats" />
</template>
