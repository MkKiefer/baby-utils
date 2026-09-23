<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { cloud, syncNow } from '@/core/cloud/service'
import { toast } from '@/composables/useToast'

/**
 * Pull down at the top of any page to sync now. Only while relay sync is on; a pull that
 * starts in a sheet, a dial, a fixed overlay or an inner scroller is left alone.
 */
const THRESHOLD = 70
const MAX = 110

const pull = ref(0)
const busy = ref(false)
const dragging = ref(false)
let startY: number | null = null

const active = computed(() => !!cloud.config?.enabled)

/** Elements whose own gestures a pull must not steal. */
function ownsGesture(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('[role="dialog"], [data-no-pull], input, textarea, select')) return true
    const style = getComputedStyle(el)
    if (style.touchAction === 'none' || style.position === 'fixed') return true
    if (el.scrollTop > 0) return true
  }
  return false
}

function onStart(e: TouchEvent) {
  startY = null
  if (!active.value || busy.value || e.touches.length !== 1 || window.scrollY > 0) return
  if (ownsGesture(e.target)) return
  startY = e.touches[0]!.clientY
}

function onMove(e: TouchEvent) {
  if (startY === null) return
  const dy = e.touches[0]!.clientY - startY
  if (dy <= 0 || window.scrollY > 0) {
    startY = null
    dragging.value = false
    pull.value = 0
    return
  }
  dragging.value = true
  // Resistance: the indicator follows at half speed, up to MAX.
  pull.value = Math.min(dy * 0.5, MAX)
}

async function onEnd() {
  if (startY === null) return
  startY = null
  dragging.value = false
  if (pull.value < THRESHOLD) {
    pull.value = 0
    return
  }
  busy.value = true
  pull.value = THRESHOLD
  try {
    await syncNow()
    if (cloud.state.lastError) toast(cloud.state.lastError, { tone: 'warn' })
    else toast('Synced', { tone: 'ok' })
  } finally {
    busy.value = false
    pull.value = 0
  }
}

onMounted(() => {
  addEventListener('touchstart', onStart, { passive: true })
  addEventListener('touchmove', onMove, { passive: true })
  addEventListener('touchend', onEnd)
  addEventListener('touchcancel', onEnd)
})
onBeforeUnmount(() => {
  removeEventListener('touchstart', onStart)
  removeEventListener('touchmove', onMove)
  removeEventListener('touchend', onEnd)
  removeEventListener('touchcancel', onEnd)
})
</script>

<template>
  <div
    v-if="active"
    class="ptr"
    :class="{ settle: !dragging, ready: pull >= THRESHOLD }"
    :style="{ transform: `translate(-50%, ${pull - 48}px)`, opacity: pull ? Math.min(pull / THRESHOLD, 1) : 0 }"
    aria-hidden="true"
  >
    <RefreshCw :size="20" :class="{ spin: busy }" :style="busy ? undefined : { transform: `rotate(${pull * 3}deg)` }" />
  </div>
</template>

<style scoped>
.ptr {
  position: fixed;
  left: 50%;
  top: var(--safe-top);
  z-index: 250;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: var(--shadow);
  color: var(--text);
  pointer-events: none;
}

.ptr.ready {
  color: var(--accent);
}

.ptr.settle {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.spin {
  animation: ptr-spin 0.9s linear infinite;
}

@keyframes ptr-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
