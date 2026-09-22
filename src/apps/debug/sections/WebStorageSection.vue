<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'

type Area = 'localStorage' | 'sessionStorage'
const entries = ref<Record<Area, { key: string; value: string }[]>>({ localStorage: [], sessionStorage: [] })

function read(area: Area) {
  const storage = window[area]
  const out: { key: string; value: string }[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!
    out.push({ key, value: storage.getItem(key) ?? '' })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

function refresh() {
  try {
    entries.value = { localStorage: read('localStorage'), sessionStorage: read('sessionStorage') }
  } catch (e) {
    console.warn(e)
  }
}

function remove(area: Area, key: string) {
  window[area].removeItem(key)
  refresh()
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <template v-for="area in ['localStorage', 'sessionStorage'] as const" :key="area">
    <strong class="small">{{ area }} ({{ entries[area].length }})</strong>
    <table v-if="entries[area].length">
      <tbody>
        <tr v-for="e in entries[area]" :key="e.key">
          <th>
            <code>{{ e.key }}</code>
          </th>
          <td>
            <code>{{ e.value }}</code>
          </td>
          <td style="width: 36px">
            <button class="icon-btn" style="width: 30px; height: 30px" aria-label="Remove" @click="remove(area, e.key)">
              <Trash2 :size="14" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="tiny faint">Empty.</p>
  </template>
  <p class="tiny muted">
    Only UI preferences live here (<code>bu.*</code>). All baby data is in IndexedDB.
  </p>
</template>
