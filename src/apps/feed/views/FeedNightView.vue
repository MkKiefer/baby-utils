<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Sun, Volume2, VolumeX, Zap, ZapOff } from 'lucide-vue-next'
import { arcPath } from '@/core/arc'
import { formatClock, formatSpan, MINUTE } from '@/core/time'
import { releaseWakeLock, requestWakeLock, wakeLockState } from '@/core/wakeLock'
import { audioState, playChime, unlockAudio } from '@/core/chime'
import { setThemeColorOverride } from '@/core/theme'
import { useFeedStore } from '../store'
import { useFeedActions } from '../useFeedActions'
import FeedEarlierSheet from '../components/FeedEarlierSheet.vue'

/**
 * Night mode: black, dim amber, screen kept on. The page stays alive, so the chime at
 * reminder times works on every platform — even where background notifications don't.
 */
const store = useFeedStore()
const router = useRouter()
const { logFeed } = useFeedActions()
void store.ensureLoaded()

const plan = computed(() => store.plan)
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const clock = computed(() => {
  const parts = clockFmt.formatToParts(plan.value.now)
  return {
    time: parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim(),
    period: parts.find((p) => p.type === 'dayPeriod')?.value ?? '',
  }
})
const cycle = computed(() => plan.value.cycles[0] ?? null)
const earlierOpen = ref(false)
const flash = ref(false)

const status = computed(() => {
  const p = plan.value
  const c = cycle.value
  if (!p.lastFeed || !c) return { line: 'No feed logged yet', big: '' }
  if (p.status === 'ok' || p.status === 'soon') return { line: `next feed ${formatClock(c.dueAt)}`, big: formatSpan(c.dueAt - p.now) }
  if (p.status === 'paused') return { line: 'reminders paused', big: `${formatSpan(p.now - p.lastFeed.at)} since last` }
  return { line: `was due ${formatClock(c.dueAt)}`, big: `+${formatSpan(p.now - c.dueAt)}` }
})

const progress = computed(() => {
  const p = plan.value
  if (!p.lastFeed) return 0
  return Math.min(1, (p.now - p.lastFeed.at) / (p.totalMin * MINUTE))
})

// Chime once for every reminder moment that passes while night mode is open.
const chimed = new Set<string>()
watch(
  () => plan.value.now,
  (now) => {
    for (const n of plan.value.notifications) {
      if (n.at <= now && now - n.at < 90_000 && !chimed.has(n.id)) {
        chimed.add(n.id)
        playChime()
        flash.value = true
        setTimeout(() => (flash.value = false), 2400)
      }
    }
  },
)

const soundOn = computed(() => audioState.state === 'running')

onMounted(() => {
  void requestWakeLock()
  setThemeColorOverride('#000000')
})
onBeforeUnmount(() => {
  void releaseWakeLock()
  setThemeColorOverride(null)
})

function exit() {
  void router.replace('/app/feed')
}
</script>

<template>
  <div class="night" :class="{ flash, due: plan.status === 'due' || plan.status === 'overdue' }">
    <header>
      <button class="nbtn" aria-label="Leave night mode" @click="exit"><Sun :size="22" /></button>
      <span class="spacer" />
      <button class="nbtn" :aria-label="soundOn ? 'Sound on' : 'Enable sound'" @click="unlockAudio">
        <Volume2 v-if="soundOn" :size="20" /><VolumeX v-else :size="20" />
      </button>
      <span class="nbtn" :title="wakeLockState.active ? 'Screen stays on' : 'Screen may turn off'">
        <Zap v-if="wakeLockState.active" :size="20" /><ZapOff v-else :size="20" />
      </span>
    </header>

    <main>
      <div class="ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="92" class="track" />
          <path :d="arcPath(100, 100, 92, 0, progress * 360)" class="arc" />
        </svg>
        <div class="inner">
          <span class="clock num"
            >{{ clock.time }}<small v-if="clock.period">{{ clock.period }}</small></span
          >
          <span class="big num">{{ status.big }}</span>
          <span class="line">{{ status.line }}</span>
        </div>
      </div>
      <p v-if="!soundOn" class="hint">Tap the speaker to allow the chime.</p>
      <p v-if="!wakeLockState.supported" class="hint">This browser can't keep the screen on — set a longer auto-lock.</p>
    </main>

    <footer>
      <button class="fed" @click="logFeed()">Fed now</button>
      <button class="earlier" @click="earlierOpen = true">Fed earlier…</button>
    </footer>
  </div>
  <FeedEarlierSheet v-model="earlierOpen" :suggested="store.suggestedKind" @save="(at, k) => logFeed(at, k)" />
</template>

<style scoped>
.night {
  --amber: #d9773f;
  --amber-dim: rgba(217, 119, 63, 0.55);
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: #000;
  color: var(--amber);
  padding: calc(8px + var(--safe-top)) 16px calc(20px + var(--safe-bottom));
  transition: background 0.6s;
}

.night.flash {
  animation: flash 0.8s ease-in-out 3;
}

@keyframes flash {
  50% {
    background: #2a0f04;
  }
}

header {
  display: flex;
  align-items: center;
  gap: 4px;
}

.spacer {
  flex: 1;
}

.nbtn {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--amber-dim);
}

main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.ring {
  position: relative;
  width: min(78vw, 360px);
  aspect-ratio: 1;
}

svg {
  width: 100%;
  height: 100%;
}

.track {
  fill: none;
  stroke: rgba(217, 119, 63, 0.12);
  stroke-width: 4;
}

.arc {
  fill: none;
  stroke: var(--amber);
  stroke-width: 4;
  stroke-linecap: round;
  opacity: 0.8;
}

.inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.clock {
  white-space: nowrap;
  font-size: clamp(52px, 17vw, 84px);
  font-weight: 300;
  letter-spacing: -0.03em;
  line-height: 1;
  opacity: 0.9;
}

.clock small {
  font-size: 0.3em;
  font-weight: 600;
  margin-left: 4px;
  letter-spacing: 0;
}

.big {
  font-size: 26px;
  font-weight: 800;
  opacity: 0.8;
}

.line {
  font-size: 15px;
  font-weight: 700;
  color: var(--amber-dim);
}

.due .big {
  animation: breathe 2.4s ease-in-out infinite;
}

@keyframes breathe {
  50% {
    opacity: 0.35;
  }
}

.hint {
  font-size: 13px;
  color: var(--amber-dim);
  text-align: center;
}

footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
}

.fed {
  min-height: 72px;
  border-radius: 999px;
  border: 2px solid var(--amber-dim);
  color: var(--amber);
  font-size: 22px;
  font-weight: 800;
}

.fed:active {
  background: rgba(217, 119, 63, 0.15);
}

.earlier {
  min-height: 44px;
  color: var(--amber-dim);
  font-weight: 700;
}
</style>
