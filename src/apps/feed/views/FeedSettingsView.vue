<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Info, Moon, RotateCcw } from 'lucide-vue-next'
import DialInput from '@/components/DialInput.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ToggleSwitch from '@/components/ToggleSwitch.vue'
import { DAY, formatDate, formatDuration, formatOffset } from '@/core/time'
import { notificationPermission, requestNotificationPermission } from '@/core/notify/permission'
import { showNotification } from '@/core/notify/scheduler'
import { toast } from '@/composables/useToast'
import { useFeedStore } from '../store'
import { AGE_INTERVALS, JAUNDICE_MAX_MIN, MANUAL_MAX, MANUAL_MIN, NIGHT_EXTRA_OPTIONS } from '../logic/intervals'
import { RHYTHM_MAX_SAMPLES, RHYTHM_MIN_SAMPLES } from '../logic/rhythm'

const store = useFeedStore()
void store.ensureLoaded()

const s = computed(() => store.settings)
const plan = computed(() => store.plan)

// ---------------------------------------------------------------- interval
const mode = computed({
  get: () => s.value.intervalMode,
  set: (v) => void store.saveSettings({ intervalMode: v }),
})
const manual = ref(s.value.manualIntervalMin)
watch(
  () => s.value.manualIntervalMin,
  (v) => (manual.value = v),
)
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(manual, (v) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (v !== s.value.manualIntervalMin) void store.saveSettings({ manualIntervalMin: v })
  }, 350)
})

// ---------------------------------------------------------------- night
const nightOn = computed({
  get: () => s.value.night.enabled,
  set: (enabled) => void store.saveSettings({ night: { ...s.value.night, enabled } }),
})
const nightExtra = computed({
  get: () => s.value.night.extraMin,
  set: (extraMin) => void store.saveSettings({ night: { ...s.value.night, extraMin } }),
})
const pad = (n: number) => String(n).padStart(2, '0')
const toTime = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
function fromTime(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const nightStart = computed({
  get: () => toTime(s.value.night.startMin),
  set: (v) => {
    const startMin = fromTime(v)
    if (startMin != null) void store.saveSettings({ night: { ...s.value.night, startMin } })
  },
})
const nightEnd = computed({
  get: () => toTime(s.value.night.endMin),
  set: (v) => {
    const endMin = fromTime(v)
    if (endMin != null) void store.saveSettings({ night: { ...s.value.night, endMin } })
  },
})

// ---------------------------------------------------------------- jaundice
const jaundice = computed({
  get: () => s.value.jaundice.active,
  set: (active) => void store.saveSettings({ jaundice: { active, since: active ? Date.now() : null } }),
})
const jaundiceDays = computed(() =>
  s.value.jaundice.since ? Math.floor((plan.value.now - s.value.jaundice.since) / DAY) : 0,
)

// ---------------------------------------------------------------- rhythm
const rhythmOn = computed({
  get: () => s.value.rhythm.enabled,
  set: (enabled) => void store.saveSettings({ rhythm: { ...s.value.rhythm, enabled } }),
})
function resetRhythm() {
  void store.saveSettings({ rhythm: { ...s.value.rhythm, resetAt: Date.now() } })
  toast('Rhythm learning restarted')
}

// ---------------------------------------------------------------- reminders
const maxUnconfirmed = computed({
  get: () => s.value.maxUnconfirmed,
  set: (v) => void store.saveSettings({ maxUnconfirmed: v }),
})
const notifyAtBase = computed({
  get: () => s.value.notifyAtBase,
  set: (v) => void store.saveSettings({ notifyAtBase: v }),
})

async function testNotification() {
  if (notificationPermission.value !== 'granted') await requestNotificationPermission()
  if (notificationPermission.value !== 'granted') return
  await showNotification({
    id: `test:${Date.now()}`,
    at: Date.now(),
    title: 'Test reminder',
    body: 'This is how feeding reminders will look.',
    tag: 'feed-test',
    source: 'feed',
    kind: 'test',
    url: '/app/feed',
    actions: [{ action: 'noop', title: 'OK' }],
  })
}
</script>

<template>
  <div class="page">
    <!-- ================================================================ interval -->
    <h2 class="section-title">Feeding interval</h2>
    <div class="card stack">
      <SegmentedControl
        v-model="mode"
        label="Interval mode"
        :options="[
          { value: 'auto', label: 'By age' },
          { value: 'manual', label: 'Manual' },
        ]"
      />
      <template v-if="mode === 'auto'">
        <div class="age-table">
          <div
            v-for="r in AGE_INTERVALS"
            :key="r.label"
            class="age-row"
            :class="{ current: plan.ageDays != null && plan.ageDays >= r.fromDay && plan.ageDays <= r.toDay }"
          >
            <span>{{ r.label }}</span>
            <strong class="num">{{ formatDuration(r.minutes) }}</strong>
          </div>
        </div>
        <p class="tiny muted">
          Start-to-start interval. Rough guidance for healthy term babies; follow your midwife or paediatrician if they
          advise otherwise (use Manual).
        </p>
      </template>
      <template v-else>
        <DialInput
          v-model="manual"
          :min="MANUAL_MIN"
          :max="MANUAL_MAX"
          :step="5"
          label="Feeding interval"
          :tick-every="15"
          :label-every="60"
          :format-tick="(v) => `${v / 60}h`"
          :format="(v) => formatDuration(v, { zeroMinutes: true })"
        >
          <span class="tiny muted" style="font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em">Every</span>
          <strong class="num dial-value">{{ formatDuration(manual, { zeroMinutes: true }) }}</strong>
          <span class="tiny muted num">by age: {{ formatDuration(plan.interval.ageMin) }}</span>
        </DialInput>
      </template>
    </div>

    <!-- ================================================================ night -->
    <h2 class="section-title">Longer at night</h2>
    <div class="card stack">
      <div class="row">
        <div class="grow">
          <strong>Night interval</strong>
          <p class="small muted">
            Feeds that start at night get a longer interval, e.g. <b>3h +1h</b>. Only if baby is gaining well — ask
            your midwife.
          </p>
        </div>
        <ToggleSwitch v-model="nightOn" label="Longer interval at night" />
      </div>
      <template v-if="nightOn">
        <div class="night-window">
          <label>
            <span class="tiny faint">From</span>
            <input v-model.lazy="nightStart" class="input" type="time" />
          </label>
          <label>
            <span class="tiny faint">Until</span>
            <input v-model.lazy="nightEnd" class="input" type="time" />
          </label>
        </div>
        <SegmentedControl
          v-model="nightExtra"
          label="Extra time at night"
          :options="NIGHT_EXTRA_OPTIONS.map((m) => ({ value: m, label: formatOffset(m) }))"
        />
        <div v-if="s.jaundice.active" class="callout warn">
          <Moon :size="18" />
          <span>Paused while jaundice mode is on — feeds stay at least every {{ formatDuration(JAUNDICE_MAX_MIN) }}.</span>
        </div>
      </template>
    </div>

    <!-- ================================================================ jaundice -->
    <h2 class="section-title">Jaundice (Gelbsucht)</h2>
    <div class="card stack">
      <div class="row">
        <div class="grow">
          <strong>Jaundice mode</strong>
          <p class="small muted">
            Feeds at least every {{ formatDuration(JAUNDICE_MAX_MIN) }} and the learned rhythm may only shorten, never
            stretch, the interval. Jaundiced babies are often sleepy — wake them for feeds.
          </p>
        </div>
        <ToggleSwitch v-model="jaundice" label="Jaundice mode" />
      </div>
      <div v-if="s.jaundice.active && s.jaundice.since" class="chip warn" style="align-self: flex-start">
        Active since {{ formatDate(s.jaundice.since) }} · {{ jaundiceDays }} {{ jaundiceDays === 1 ? 'day' : 'days' }}
      </div>
      <div v-if="s.jaundice.active && jaundiceDays >= 14" class="callout">
        <Info :size="18" />
        <span>Newborn jaundice usually clears within about two weeks. Turn this off once your midwife says so.</span>
      </div>
    </div>

    <!-- ================================================================ rhythm -->
    <h2 class="section-title">Baby's rhythm</h2>
    <div class="card stack">
      <div class="row">
        <div class="grow">
          <strong>Learn from logged feeds</strong>
          <p class="small muted">
            If feeds keep happening later (or earlier) than planned, the timer adapts, e.g.
            <b>2h +30m</b>. Long gaps (probably unlogged feeds) and cluster feeds are ignored.
          </p>
        </div>
        <ToggleSwitch v-model="rhythmOn" label="Learn rhythm" />
      </div>
      <div v-if="rhythmOn" class="rhythm-status">
        <div>
          <span class="tiny faint">Current adjustment</span>
          <strong class="num">{{ formatOffset(plan.rhythm.offsetMin) }}</strong>
        </div>
        <div>
          <span class="tiny faint">Based on</span>
          <strong class="num">{{ plan.rhythm.usedCount }} / {{ RHYTHM_MAX_SAMPLES }} feeds</strong>
        </div>
        <div>
          <span class="tiny faint">Limits</span>
          <strong class="num">{{ formatOffset(plan.rhythm.bounds.min) }} … {{ formatOffset(plan.rhythm.bounds.max) }}</strong>
        </div>
      </div>
      <p v-if="rhythmOn && plan.rhythm.state === 'learning'" class="tiny muted">
        Needs at least {{ RHYTHM_MIN_SAMPLES }} regular intervals from the last 7 days.
      </p>
      <button v-if="rhythmOn" class="btn sm" style="align-self: flex-start" @click="resetRhythm">
        <RotateCcw :size="16" /> Restart learning
      </button>
    </div>

    <!-- ================================================================ reminders -->
    <h2 class="section-title">Reminders</h2>
    <div class="card stack">
      <div>
        <strong>Unanswered reminders before pausing</strong>
        <p class="small muted">
          At night feeds sometimes go unlogged. After this many reminders without a logged feed the app stays quiet
          until the next feed is logged.
        </p>
      </div>
      <SegmentedControl
        v-model="maxUnconfirmed"
        label="Reminders before pausing"
        :options="[
          { value: 0, label: 'Off' },
          { value: 1, label: '1' },
          { value: 2, label: '2' },
          { value: 3, label: '3' },
        ]"
      />
      <div class="row">
        <div class="grow">
          <strong>Also remind at the age interval</strong>
          <p class="small muted">
            When baby's rhythm pushes feeding later, still send a heads-up when the age-based interval is reached.
          </p>
        </div>
        <ToggleSwitch v-model="notifyAtBase" label="Remind at age interval" />
      </div>
      <div class="row">
        <div class="grow">
          <strong>Notifications</strong>
          <p class="small muted">Permission: {{ notificationPermission }}</p>
        </div>
        <button class="btn sm" @click="testNotification">Send test</button>
      </div>
    </div>

    <div class="callout info" style="margin-top: 16px">
      <Info :size="18" />
      <div>
        <strong>How reminders work.</strong> Everything runs on this device — no server. Browsers can only fire a
        reminder while the app is running; phones may freeze apps in the background. For night feeds, open
        <b>night mode</b> (moon icon): it keeps the screen on, dimmed, and chimes when it's time.
      </div>
    </div>
  </div>
</template>

<style scoped>
.age-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.age-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.age-row.current {
  background: var(--accent-soft);
  color: var(--text);
}

.dial-value {
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.night-window {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.night-window label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rhythm-status {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.rhythm-status > div {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--surface-2);
}

.rhythm-status strong {
  font-size: 16px;
  font-weight: 900;
}
</style>
