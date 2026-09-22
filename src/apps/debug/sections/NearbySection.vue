<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { compressionSupported, FRAME_CHARS, FrameCollector, unpackPayload } from '@/core/nearby/codec'
import { cameraSupported, nativeQrSupported, scannerState } from '@/core/nearby/scanner'
import { buildOffer, defaultScope, RECENT_WINDOW, type NearbyScope } from '@/core/nearby/sync'
import { readLastMerge, type LastMerge } from '@/core/merge'
import { formatDateTime } from '@/core/time'
import JsonView from '../components/JsonView.vue'

/** QR phone-to-phone sync: what this browser supports and what a sync would send. */
const support = ref<Record<string, string>>({})
const offers = ref<Record<NearbyScope, string>>({ recent: '…', all: '…' })
const lastMerge = ref<LastMerge | null>(null)
const scope = ref<NearbyScope | ''>('')
const selfTest = ref('')

async function refresh() {
  let camera = 'not supported'
  try {
    camera = (await navigator.permissions.query({ name: 'camera' as PermissionName })).state
  } catch {
    // Firefox and older Safari cannot query the camera permission.
  }
  let cameras = '—'
  try {
    cameras = String((await navigator.mediaDevices?.enumerateDevices())?.filter((d) => d.kind === 'videoinput').length ?? 0)
  } catch (e) {
    cameras = String(e)
  }
  support.value = {
    getUserMedia: cameraSupported ? 'yes' : 'no',
    'Camera permission': camera,
    'Video inputs': cameras,
    BarcodeDetector: (await nativeQrSupported()) ? 'yes (qr_code) — used' : 'no — jsQR fallback',
    'CompressionStream (deflate-raw)': compressionSupported ? 'yes' : 'no — codes sent uncompressed',
    Vibration: 'vibrate' in navigator ? 'yes' : 'no',
    'Chars per code': String(FRAME_CHARS),
    'Recent window': `${RECENT_WINDOW / 86_400_000} days`,
  }
  for (const s of ['recent', 'all'] as const) {
    const o = await buildOffer(s)
    offers.value[s] = `${o.entries} feeds · ${o.chars} chars · ${o.frames.length} codes`
  }
  lastMerge.value = await readLastMerge()
  scope.value = await defaultScope()
}

/** Round-trips the full log through frames and decoding, without a camera. */
async function runSelfTest() {
  const t0 = performance.now()
  try {
    const o = await buildOffer('all')
    const collector = new FrameCollector()
    let data: string | null = null
    for (const f of [...o.frames].reverse()) data = collector.add(f)?.data ?? data
    const back = await unpackPayload(data!)
    const ok = back.records.length === o.entries
    selfTest.value = `${ok ? 'OK' : 'MISMATCH'} — ${back.records.length}/${o.entries} feeds in ${Math.round(performance.now() - t0)} ms`
  } catch (e) {
    selfTest.value = `Failed: ${String(e)}`
  }
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <strong class="small">Support</strong>
  <table>
    <tbody>
      <tr v-for="(v, k) in support" :key="k">
        <th>{{ k }}</th>
        <td>{{ v }}</td>
      </tr>
    </tbody>
  </table>

  <strong class="small">What a sync would send now</strong>
  <table>
    <tbody>
      <tr>
        <th>Last 2 weeks</th>
        <td>{{ offers.recent }}</td>
      </tr>
      <tr>
        <th>Everything</th>
        <td>{{ offers.all }}</td>
      </tr>
      <tr>
        <th>Default choice</th>
        <td>{{ scope }}</td>
      </tr>
      <tr>
        <th>Last merge</th>
        <td>
          <template v-if="lastMerge">{{ formatDateTime(lastMerge.at) }} via {{ lastMerge.via ?? 'file' }}</template>
          <template v-else>never</template>
        </td>
      </tr>
    </tbody>
  </table>
  <button class="btn sm" style="align-self: flex-start" @click="runSelfTest">Encode/decode self-test</button>
  <p v-if="selfTest" class="small">{{ selfTest }}</p>

  <strong class="small">Scanner state (this session)</strong>
  <JsonView :value="scannerState" />
</template>
