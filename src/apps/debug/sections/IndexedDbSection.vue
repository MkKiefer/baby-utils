<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { getDB } from '@/core/db'
import { DB_NAME, STORES, type StoreName } from '@/core/schema'
import { emitChange } from '@/core/sync'
import ConfirmButton from '@/components/ConfirmButton.vue'
import JsonView from '../components/JsonView.vue'

interface StoreInfo {
  name: StoreName
  owner: string
  keyPath: string | null
  indexes: string[]
  count: number
}

const databases = ref<{ name?: string; version?: number }[] | null>(null)
const version = ref(0)
const stores = ref<StoreInfo[]>([])
const openStore = ref<StoreName | null>(null)
const records = shallowRef<{ key: IDBValidKey; value: unknown }[]>([])
const limit = ref(25)

async function refresh() {
  databases.value = (await indexedDB.databases?.()) ?? null
  const db = await getDB()
  version.value = db.version
  const tx = db.transaction(STORES.map((s) => s.name))
  stores.value = await Promise.all(
    STORES.map(async (s) => {
      const store = tx.objectStore(s.name)
      return {
        name: s.name,
        owner: s.owner,
        keyPath: (store.keyPath as string | null) ?? null,
        indexes: [...store.indexNames],
        count: await store.count(),
      }
    }),
  )
  if (openStore.value) await loadRecords(openStore.value)
}

async function loadRecords(name: StoreName) {
  const db = await getDB()
  const out: { key: IDBValidKey; value: unknown }[] = []
  // Newest first: walk the primary key backwards.
  let cursor = await db.transaction(name).store.openCursor(null, 'prev')
  while (cursor && out.length < limit.value) {
    out.push({ key: cursor.primaryKey, value: cursor.value })
    cursor = await cursor.continue()
  }
  records.value = out
}

async function toggle(name: StoreName) {
  openStore.value = openStore.value === name ? null : name
  limit.value = 25
  if (openStore.value) await loadRecords(name)
}

function scopeFor(name: StoreName) {
  return name === 'feeds' ? 'feeds' : name === 'notifLog' ? 'notifications' : 'all'
}

async function deleteRecord(name: StoreName, key: IDBValidKey) {
  const db = await getDB()
  await db.delete(name, key as never)
  emitChange(scopeFor(name))
  await refresh()
}

async function clearStore(name: StoreName) {
  const db = await getDB()
  await db.clear(name)
  emitChange(scopeFor(name))
  await refresh()
}

async function more() {
  limit.value += 50
  if (openStore.value) await loadRecords(openStore.value)
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <table>
    <tbody>
      <tr>
        <th>Database</th>
        <td>
          <code>{{ DB_NAME }}</code> v{{ version }}
        </td>
      </tr>
      <tr v-if="databases">
        <th>All databases on origin</th>
        <td>
          <code v-for="d in databases" :key="d.name">{{ d.name }} (v{{ d.version }}) </code>
        </td>
      </tr>
    </tbody>
  </table>

  <div v-for="s in stores" :key="s.name" class="store">
    <button class="store-head" @click="toggle(s.name)">
      <code class="name">{{ s.name }}</code>
      <span class="tiny faint">{{ s.owner }} · key {{ s.keyPath ?? 'out-of-line' }}{{ s.indexes.length ? ` · idx ${s.indexes.join(', ')}` : '' }}</span>
      <span class="spacer" />
      <span class="chip">{{ s.count }}</span>
    </button>
    <div v-if="openStore === s.name" class="records">
      <div v-for="r in records" :key="String(r.key)" class="record">
        <div class="row">
          <code class="tiny faint">{{ String(r.key) }}</code>
          <span class="spacer" />
          <button class="icon-btn" aria-label="Delete record" @click="deleteRecord(s.name, r.key)"><Trash2 :size="15" /></button>
        </div>
        <JsonView :value="r.value" :max="4000" />
      </div>
      <p v-if="!records.length" class="tiny faint">Empty.</p>
      <button v-if="records.length < s.count" class="btn sm" @click="more">Load more ({{ records.length }}/{{ s.count }})</button>
      <ConfirmButton :label="`Clear ${s.name}`" class="sm" @confirm="clearStore(s.name)" />
    </div>
  </div>
</template>

<style scoped>
.store {
  border-top: 1px solid var(--line);
}

.store-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  text-align: left;
  flex-wrap: wrap;
}

.name {
  font-weight: 800;
}

.records {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 12px;
}

.record .icon-btn {
  width: 32px;
  height: 32px;
}
</style>
