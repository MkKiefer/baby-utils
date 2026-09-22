<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { formatBytes, refreshStorage, requestPersistence, storageState } from '@/core/storage'
import { periodicSyncManager, swState } from '@/core/pwa'
import { wakeLockState, requestWakeLock, releaseWakeLock } from '@/core/wakeLock'
import { audioState, playChime, unlockAudio } from '@/core/chime'
import { syncInfo, syncLog, type ChangeEvent } from '@/core/sync'
import { themeState } from '@/core/theme'
import { formatDateTime } from '@/core/time'
import JsonView from '../components/JsonView.vue'

const PERMISSIONS = ['notifications', 'persistent-storage', 'periodic-background-sync', 'screen-wake-lock', 'background-sync', 'camera']
const permissions = ref<Record<string, string>>({})
const periodicTags = ref<string[] | string>('—')
const messages = ref<ChangeEvent[]>([])

async function refresh() {
  await refreshStorage()
  const out: Record<string, string> = {}
  for (const name of PERMISSIONS) {
    try {
      out[name] = (await navigator.permissions.query({ name: name as PermissionName })).state
    } catch {
      out[name] = 'not supported'
    }
  }
  permissions.value = out
  const manager = periodicSyncManager(await (navigator.serviceWorker?.getRegistration() ?? Promise.resolve(null)) ?? null)
  periodicTags.value = manager ? await manager.getTags().catch((e: unknown) => String(e)) : 'unsupported'
  messages.value = [...syncLog]
}

async function toggleWakeLock() {
  if (wakeLockState.wanted) await releaseWakeLock()
  else await requestWakeLock()
}

function chime() {
  unlockAudio()
  setTimeout(() => playChime(), 100)
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <strong class="small">Storage (navigator.storage)</strong>
  <table>
    <tbody>
      <tr>
        <th>Persisted</th>
        <td>{{ storageState.persisted ?? 'unknown' }}</td>
      </tr>
      <tr>
        <th>Usage / quota</th>
        <td>{{ formatBytes(storageState.usage) }} / {{ formatBytes(storageState.quota) }}</td>
      </tr>
    </tbody>
  </table>
  <JsonView v-if="storageState.details" :value="storageState.details" />
  <button class="btn sm" style="align-self: flex-start" @click="requestPersistence">Request persistence</button>

  <strong class="small">Permissions API</strong>
  <table>
    <tbody>
      <tr v-for="(v, k) in permissions" :key="k">
        <th>{{ k }}</th>
        <td>{{ v }}</td>
      </tr>
    </tbody>
  </table>

  <strong class="small">Periodic Background Sync</strong>
  <table>
    <tbody>
      <tr>
        <th>Registration</th>
        <td>{{ swState.periodicSync || '—' }}</td>
      </tr>
      <tr>
        <th>Tags</th>
        <td>
          <code>{{ periodicTags }}</code>
        </td>
      </tr>
    </tbody>
  </table>

  <strong class="small">Screen Wake Lock</strong>
  <JsonView :value="wakeLockState" />
  <button class="btn sm" style="align-self: flex-start" @click="toggleWakeLock">
    {{ wakeLockState.wanted ? 'Release' : 'Acquire' }} wake lock
  </button>

  <strong class="small">Web Audio (night chime)</strong>
  <JsonView :value="audioState" />
  <button class="btn sm" style="align-self: flex-start" @click="chime">Play chime</button>

  <strong class="small">Theme</strong>
  <JsonView :value="themeState" />

  <strong class="small">BroadcastChannel "{{ syncInfo.channel }}" · this context {{ syncInfo.origin }}</strong>
  <table v-if="messages.length">
    <tbody>
      <tr v-for="m in messages" :key="`${m.at}-${m.origin}-${m.scope}`">
        <th>{{ formatDateTime(m.at) }}</th>
        <td>
          {{ m.scope }} · {{ m.local ? 'local' : `from ${m.origin}` }}
        </td>
      </tr>
    </tbody>
  </table>
  <p v-else class="tiny faint">No messages yet.</p>
</template>
