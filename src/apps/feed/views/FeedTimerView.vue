<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BellOff, BellRing, ChevronRight, Moon, PauseCircle, Pencil, Sun } from 'lucide-vue-next'
import { formatClock, formatDuration, formatOffset, formatSpan, formatDayLabel } from '@/core/time'
import { notificationPermission, requestNotificationPermission } from '@/core/notify/permission'
import { unlockAudio } from '@/core/chime'
import { useFeedStore } from '../store'
import { useFeedActions } from '../useFeedActions'
import FeedDial from '../components/FeedDial.vue'
import KindPicker from '../components/KindPicker.vue'
import FeedEarlierSheet from '../components/FeedEarlierSheet.vue'
import FeedEditSheet from '../components/FeedEditSheet.vue'
import { KIND_LABEL, type FeedEntry, type FeedKind } from '../logic/types'

const store = useFeedStore()
const router = useRouter()
const { logFeed, removeFeed, saveFeed } = useFeedActions()
void store.ensureLoaded()

const MODE_KEY = 'bu.feed.dialMode'
const mode = ref<'timer' | 'day'>(readMode())
function readMode(): 'timer' | 'day' {
  try {
    return localStorage.getItem(MODE_KEY) === 'day' ? 'day' : 'timer'
  } catch {
    return 'timer'
  }
}
watch(mode, (m) => {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* ignore */
  }
})

const kind = ref<FeedKind | undefined>()
const earlierOpen = ref(false)
const busy = ref(false)

const plan = computed(() => store.plan)
const last = computed(() => plan.value.lastFeed)
const recent = computed(() => [...store.feeds].reverse().slice(0, 3))

const editing = ref<FeedEntry | null>(null)
const editOpen = ref(false)
function edit(f: FeedEntry) {
  editing.value = f
  editOpen.value = true
}

const intervalSource = computed(() => {
  const p = plan.value
  const parts = [p.interval.source === 'manual' ? 'manual' : 'by age']
  if (p.interval.jaundiceCapped) parts.push('jaundice cap')
  if (p.rhythm.state === 'learning') parts.push(`learning rhythm ${p.rhythm.usedCount}/3`)
  else if (p.rhythm.state === 'active' && p.offsetMin) parts.push('rhythm')
  return parts.join(' · ')
})

const reminderText = computed(() => {
  const p = plan.value
  if (!p.remindersEnabled) return { value: 'Off', hint: 'in settings' }
  if (p.status === 'paused') return { value: 'Paused', hint: `after ${p.cycles.length} unanswered` }
  if (!p.nextReminder) return { value: '—', hint: '' }
  return {
    value: formatClock(p.nextReminder.at),
    hint: p.nextReminder.kind === 'base' ? 'age reminder' : p.unanswered ? `reminder ${p.unanswered + 1}` : 'feeding time',
  }
})

async function fedNow() {
  if (busy.value) return
  busy.value = true
  try {
    await logFeed(Date.now(), kind.value)
    kind.value = undefined
  } finally {
    busy.value = false
  }
}

async function fedEarlier(at: number, k: FeedKind | undefined) {
  await logFeed(at, k)
  kind.value = undefined
}

function openNight() {
  unlockAudio() // needs this tap to allow the chime later
  void router.push('/app/feed/night')
}
</script>

<template>
  <Teleport defer to="#appbar-actions">
    <button class="icon-btn" aria-label="Night mode" @click="openNight"><Moon :size="22" /></button>
  </Teleport>

  <div class="page stack">
    <div class="dial-wrap">
      <FeedDial :plan="plan" :feeds="store.last24h" :mode="mode" @toggle="mode = mode === 'timer' ? 'day' : 'timer'" />
      <div class="mode-switch" role="tablist" aria-label="Dial view">
        <button :class="{ on: mode === 'timer' }" role="tab" :aria-selected="mode === 'timer'" @click="mode = 'timer'">Timer</button>
        <button :class="{ on: mode === 'day' }" role="tab" :aria-selected="mode === 'day'" @click="mode = 'day'">
          <Sun :size="13" /> 24h
        </button>
      </div>
    </div>

    <div class="facts">
      <div class="fact">
        <span class="k">Last feed</span>
        <strong class="num">{{ last ? formatClock(last.at) : '—' }}</strong>
        <span class="h">{{
          last ? `${formatSpan(plan.now - last.at)} ago${last.kind ? ` · ${KIND_LABEL[last.kind]}` : ''}` : 'none yet'
        }}</span>
      </div>
      <div class="fact">
        <span class="k">Interval</span>
        <strong class="num">
          {{ formatDuration(plan.baseMin) }}<em v-if="plan.offsetMin" :class="{ neg: plan.offsetMin < 0 }">{{ formatOffset(plan.offsetMin) }}</em>
        </strong>
        <span class="h">{{ intervalSource }}</span>
      </div>
      <div class="fact">
        <span class="k">Reminder</span>
        <strong class="num">{{ reminderText.value }}</strong>
        <span class="h">{{ reminderText.hint }}</span>
      </div>
    </div>

    <div v-if="plan.status === 'paused'" class="callout warn">
      <PauseCircle :size="20" />
      <div>
        <strong>Reminders paused.</strong> {{ plan.cycles.length }} reminders went unanswered — probably fed without
        logging. Log the next feed to resume.
      </div>
    </div>
    <div v-if="plan.offsetMin > 0 && plan.status === 'soon' && plan.cycles[0] && plan.now >= plan.cycles[0].baseAt" class="callout accent">
      <BellRing :size="20" />
      <div>
        <strong>By age it's feeding time.</strong> Baby usually goes {{ formatOffset(plan.offsetMin) }} longer — expected at
        {{ formatClock(plan.cycles[0].dueAt) }}.
      </div>
    </div>
    <button
      v-if="plan.remindersEnabled && notificationPermission !== 'granted' && notificationPermission !== 'unsupported'"
      class="callout info"
      @click="requestNotificationPermission"
    >
      <BellOff :size="20" />
      <div style="text-align: left">
        <strong>Notifications are off.</strong>
        {{ notificationPermission === 'denied' ? 'Allow them in the system settings for this app.' : 'Tap to allow reminders.' }}
      </div>
    </button>

    <KindPicker v-model="kind" :suggested="store.suggestedKind" />
    <button class="btn primary block lg fed" :disabled="busy" @click="fedNow">Fed now</button>
    <button class="btn ghost block" @click="earlierOpen = true">Fed earlier…</button>

    <div class="row" style="margin-top: 8px">
      <h2 class="section-title" style="margin: 0 6px">Recent</h2>
      <span class="spacer" />
      <RouterLink to="/app/feed/history" class="btn sm ghost">History <ChevronRight :size="16" /></RouterLink>
    </div>
    <div v-if="recent.length" class="list">
      <button v-for="f in recent" :key="f.id" class="list-item" title="Edit feed" @click="edit(f)">
        <span class="dot" />
        <div class="grow">
          <strong class="num">{{ formatClock(f.at) }}</strong>
          <span class="muted small"> · {{ formatDayLabel(f.at, plan.now) }}</span>
        </div>
        <span v-if="f.kind" class="chip">{{ KIND_LABEL[f.kind] }}</span>
        <Pencil :size="15" class="faint" aria-hidden="true" />
      </button>
    </div>
    <p v-else class="muted small" style="padding: 0 6px">No feeds logged yet.</p>
  </div>

  <FeedEarlierSheet v-model="earlierOpen" :suggested="store.suggestedKind" :initial-kind="kind" @save="fedEarlier" />
  <FeedEditSheet v-model="editOpen" :entry="editing" @save="saveFeed" @delete="(id) => removeFeed(id)" />
</template>

<style scoped>
.dial-wrap {
  padding-top: 8px;
}

.mode-switch {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
}

.mode-switch button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-3);
}

.mode-switch button.on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 12px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.fact .k {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-3);
}

.fact strong {
  font-size: 19px;
  font-weight: 900;
  white-space: nowrap;
}

.fact strong em {
  font-style: normal;
  font-size: 14px;
  margin-left: 3px;
  color: var(--accent);
}

.fact strong em.neg {
  color: var(--info);
}

.fact .h {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fed {
  margin-top: 4px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}

button.callout {
  width: 100%;
}
</style>
