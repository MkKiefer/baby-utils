<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftRight, CircleCheck, QrCode as QrIcon, ScanLine } from 'lucide-vue-next'
import AppBar from '@/components/AppBar.vue'
import QrCode from '@/components/QrCode.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { changedCount, describeMerge, type MergeStats } from '@/core/merge'
import { FrameCollector } from '@/core/nearby/codec'
import { cameraSupported, scannerState, startScanner } from '@/core/nearby/scanner'
import { buildOffer, defaultScope, receiveOffer, type NearbyOffer, type NearbyScope } from '@/core/nearby/sync'
import { releaseWakeLock, requestWakeLock, wakeLockState } from '@/core/wakeLock'

/**
 * Two phones next to each other: one shows a looping QR animation, the other films it and
 * merges. Then they swap, so each ends up with the other's feeds.
 */
const router = useRouter()

type Step = 'start' | 'show' | 'scan' | 'result'
const step = ref<Step>('start')
const didShow = ref(false)
const didScan = ref(false)

const scope = ref<NearbyScope>('recent')
onMounted(async () => (scope.value = await defaultScope()))

// ------------------------------------------------------------------ show
/** Codes per second. Slow enough that a jsQR phone still catches most of them. */
const FPS = 5
const offer = ref<NearbyOffer | null>(null)
const frame = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
/** True when the wake lock was already held (night mode) — then it is not ours to release. */
let hadWakeLock = true

async function show() {
  stopScan()
  stopShow()
  step.value = 'show'
  didShow.value = true
  offer.value = await buildOffer(scope.value)
  frame.value = 0
  clearInterval(timer)
  timer = setInterval(() => {
    if (offer.value) frame.value = (frame.value + 1) % offer.value.frames.length
  }, 1000 / FPS)
  // The other phone may take a while to line up; do not let the screen dim meanwhile.
  hadWakeLock = wakeLockState.wanted
  if (!hadWakeLock) void requestWakeLock()
}

function stopShow() {
  clearInterval(timer)
  timer = undefined
  if (!hadWakeLock && wakeLockState.wanted) void releaseWakeLock()
  hadWakeLock = true
}

watch(scope, () => {
  if (step.value === 'show') void show()
})

const loopSeconds = computed(() => (offer.value ? Math.ceil(offer.value.frames.length / FPS) : 0))

// ------------------------------------------------------------------ scan
const video = ref<HTMLVideoElement>()
const progress = ref({ received: 0, total: 0 })
const scanError = ref('')
const merging = ref(false)
const collector = new FrameCollector()
let stopCamera: (() => void) | null = null

async function scan() {
  stopShow()
  step.value = 'scan'
  scanError.value = ''
  progress.value = { received: 0, total: 0 }
  collector.reset()
  await nextTick()
  if (!video.value) return
  try {
    stopCamera = await startScanner(video.value, onCode)
  } catch (e) {
    scanError.value = (e as Error).message
  }
}

function onCode(text: string) {
  if (merging.value) return
  const p = collector.add(text)
  if (!p) return
  progress.value = { received: p.received, total: p.total }
  if ('vibrate' in navigator && p.received === 1) navigator.vibrate(30)
  if (p.data) void finish(p.data)
}

const result = ref<MergeStats | null>(null)

async function finish(data: string) {
  merging.value = true
  stopScan()
  try {
    result.value = await receiveOffer(data)
    didScan.value = true
    step.value = 'result'
    if ('vibrate' in navigator) navigator.vibrate([40, 60, 40])
  } catch (e) {
    scanError.value = (e as Error).message
    collector.reset()
  } finally {
    merging.value = false
  }
}

function stopScan() {
  stopCamera?.()
  stopCamera = null
}

function leaveScan() {
  if (didShow.value) return void show()
  stopScan()
  step.value = 'start'
}

const percent = computed(() => (progress.value.total ? Math.round((progress.value.received / progress.value.total) * 100) : 0))

onBeforeUnmount(() => {
  stopScan()
  stopShow()
})

function done() {
  void router.push('/settings')
}
</script>

<template>
  <AppBar title="Sync nearby" back="/settings" />
  <div class="page stack">
    <!-- ---------------------------------------------------------------- start -->
    <template v-if="step === 'start'">
      <div class="callout info">
        <ArrowLeftRight :size="20" />
        <p>
          Open this screen on <strong>both phones</strong>. One shows its code, the other scans it — then swap. Feeds,
          edits and deletions are merged; settings stay on each phone.
        </p>
      </div>

      <h2 class="section-title">What to send</h2>
      <SegmentedControl
        v-model="scope"
        label="What to send"
        :options="[
          { value: 'recent', label: 'Last 2 weeks' },
          { value: 'all', label: 'Everything' },
        ]"
      />
      <p class="tiny faint hint">
        Use <b>Everything</b> the first time. Afterwards, recent changes are enough as long as you sync at least every
        two weeks.
      </p>

      <button class="btn primary block lg" @click="show"><QrIcon :size="22" /> Show my code</button>
      <button class="btn block lg" :disabled="!cameraSupported" @click="scan"><ScanLine :size="22" /> Scan other phone</button>
      <p v-if="!cameraSupported" class="tiny faint hint">This browser has no camera access, so it can only show codes.</p>
    </template>

    <!-- ---------------------------------------------------------------- show -->
    <template v-else-if="step === 'show'">
      <p class="small muted center">Hold this screen in front of the other phone's camera.</p>
      <div class="card qr-card">
        <QrCode v-if="offer" :value="offer.frames[frame]" />
        <div v-else class="qr-placeholder" />
      </div>
      <p v-if="offer" class="tiny faint center num">
        {{ offer.entries }} {{ offer.entries === 1 ? 'feed' : 'feeds' }} · code {{ frame + 1 }}/{{ offer.frames.length }} ·
        loops every {{ loopSeconds }} s
      </p>
      <SegmentedControl
        v-model="scope"
        label="What to send"
        :options="[
          { value: 'recent', label: 'Last 2 weeks' },
          { value: 'all', label: 'Everything' },
        ]"
      />
      <button v-if="!didScan" class="btn primary block lg" @click="scan">
        <ScanLine :size="22" /> Next: scan their code
      </button>
      <button v-else class="btn primary block lg" @click="done"><CircleCheck :size="22" /> Done</button>
    </template>

    <!-- ---------------------------------------------------------------- scan -->
    <template v-else-if="step === 'scan'">
      <p class="small muted center">Point the camera at the code on the other phone.</p>
      <div class="viewfinder">
        <video ref="video" playsinline muted />
        <div class="frame" />
      </div>
      <div class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${percent}%` }" />
      </div>
      <p class="tiny faint center num">
        <template v-if="merging">Merging…</template>
        <template v-else-if="progress.total">{{ progress.received }} / {{ progress.total }} codes read</template>
        <template v-else-if="scannerState.camera === 'starting'">Starting camera…</template>
        <template v-else>Waiting for a code…</template>
      </p>
      <div v-if="scanError" class="callout warn">
        <p>{{ scanError }}</p>
      </div>
      <button v-if="scanError" class="btn block" @click="scan">Try again</button>
      <button class="btn ghost block" @click="leaveScan">
        {{ didShow ? 'Back to my code' : 'Cancel' }}
      </button>
    </template>

    <!-- ---------------------------------------------------------------- result -->
    <template v-else-if="step === 'result' && result">
      <div class="card stack center result">
        <CircleCheck :size="48" class="ok" />
        <strong>{{ describeMerge(result) }}</strong>
        <p class="small muted">
          {{
            changedCount(result)
              ? 'The other phone’s feeds are now on this one.'
              : 'This phone already had everything the other one sent.'
          }}
        </p>
      </div>
      <template v-if="!didShow">
        <p class="small muted center">Now let the other phone scan this one, so it gets your feeds too.</p>
        <button class="btn primary block lg" @click="show"><QrIcon :size="22" /> Show my code</button>
      </template>
      <template v-else>
        <p class="small muted center">Both phones are in sync.</p>
        <button class="btn primary block lg" @click="done">Done</button>
      </template>
      <button class="btn ghost block" @click="scan">Scan again</button>
    </template>
  </div>
</template>

<style scoped>
.center {
  text-align: center;
}

.hint {
  padding: 0 6px;
}

.qr-card {
  padding: 12px;
  background: #fff;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
}

.qr-placeholder {
  aspect-ratio: 1;
}

.viewfinder {
  position: relative;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
}

.viewfinder video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.viewfinder .frame {
  position: absolute;
  inset: 12%;
  border: 3px solid rgba(255, 255, 255, 0.85);
  border-radius: 18px;
  pointer-events: none;
}

.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s var(--ease);
}

.result {
  align-items: center;
  padding: 24px 16px;
}

.ok {
  color: var(--ok);
}
</style>
