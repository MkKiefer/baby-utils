<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { SYNC_API } from '@/core/cloud/api'
import { decryptMessage, encryptMessage, newMemberId } from '@/core/cloud/crypto'
import { pendingEntries } from '@/core/cloud/engine'
import { cloud, cloudLog, groupKeys, POLL_MS, relayHealth } from '@/core/cloud/service'
import { cameraSupported, nativeQrSupported, scannerState } from '@/core/scanner'
import { getDB } from '@/core/db'
import { formatDateTime } from '@/core/time'
import { readFeedRecords } from '@/apps/feed/logic/repo'
import JsonView from '../components/JsonView.vue'

/** Relay sync: config, derived ids, what is pending, the relay's health and a crypto self-test. */
const info = ref<Record<string, string>>({})
const log = ref<unknown[]>([])
const health = ref('')
const selfTest = ref('')
const revealSecret = ref(false)

async function refresh() {
  const c = cloud.config
  const records = await readFeedRecords(await getDB())
  info.value = {
    API: SYNC_API,
    'Web Crypto (subtle)': globalThis.crypto?.subtle ? 'yes' : 'no',
    'CompressionStream (deflate-raw)': typeof CompressionStream !== 'undefined' ? 'yes' : 'no — sent uncompressed',
    'Poll interval': `${POLL_MS / 1000} s while visible`,
    'Camera (pairing)': cameraSupported ? 'yes' : 'no',
    'QR engine': (await nativeQrSupported()) ? 'BarcodeDetector' : 'jsQR',
    Group: c ? (c.enabled ? 'joined, enabled' : 'joined, paused') : 'none',
  }
  if (c) {
    Object.assign(info.value, {
      'Group id (what the server sees)': (await groupKeys(c.secret)).groupId,
      'Member id': c.memberId,
      'Device name': c.label,
      'Joined at': formatDateTime(c.createdAt),
      'Last sync': cloud.state.lastSyncAt ? formatDateTime(cloud.state.lastSyncAt) : 'never',
      'Last error': cloud.state.lastError ?? '—',
      'Entries known to the group': `${Object.keys(cloud.state.known).length} of ${records.length}`,
      'Pending to send': String(pendingEntries(records, cloud.state.known).length),
    })
  }
  log.value = [...cloudLog]
}

async function checkHealth() {
  const t0 = performance.now()
  try {
    health.value = `${JSON.stringify(await relayHealth())} in ${Math.round(performance.now() - t0)} ms`
  } catch (e) {
    health.value = `Failed: ${(e as Error).message}`
  }
}

/** Encrypts and decrypts the whole feed log with the group key (or a throwaway one). */
async function runSelfTest() {
  const t0 = performance.now()
  try {
    const keys = await groupKeys(cloud.config?.secret ?? 'A'.repeat(43))
    const from = newMemberId()
    const feeds = await readFeedRecords(await getDB())
    const body = await encryptMessage(keys, from, { v: 1, feeds })
    const back = (await decryptMessage(keys, from, body)) as { feeds: unknown[] }
    let tamperRejected = false
    try {
      await decryptMessage(keys, newMemberId(), body)
    } catch {
      tamperRejected = true
    }
    const ok = back.feeds.length === feeds.length && tamperRejected
    selfTest.value = `${ok ? 'OK' : 'MISMATCH'} — ${feeds.length} feeds → ${body.length} chars, wrong sender ${
      tamperRejected ? 'rejected' : 'ACCEPTED'
    }, ${Math.round(performance.now() - t0)} ms`
  } catch (e) {
    selfTest.value = `Failed: ${String(e)}`
  }
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <table>
    <tbody>
      <tr v-for="(v, k) in info" :key="k">
        <th>{{ k }}</th>
        <td style="word-break: break-all">{{ v }}</td>
      </tr>
      <tr v-if="cloud.config">
        <th>Group secret</th>
        <td style="word-break: break-all">
          <template v-if="revealSecret">{{ cloud.config.secret }}</template>
          <button v-else class="btn sm" @click="revealSecret = true">Reveal</button>
        </td>
      </tr>
    </tbody>
  </table>
  <div style="display: flex; gap: 8px; flex-wrap: wrap">
    <button class="btn sm" @click="checkHealth">Relay health</button>
    <button class="btn sm" @click="runSelfTest">Encrypt/decrypt self-test</button>
  </div>
  <p v-if="health" class="small" style="word-break: break-all">{{ health }}</p>
  <p v-if="selfTest" class="small">{{ selfTest }}</p>

  <strong class="small">Sync state (localStorage sync.state)</strong>
  <JsonView :value="{ ...cloud.state, known: `${Object.keys(cloud.state.known).length} entries` }" />
  <strong class="small">Rounds this session</strong>
  <JsonView :value="log" />
  <strong class="small">Scanner state (pairing)</strong>
  <JsonView :value="scannerState" />
</template>
