<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bell, StickyNote } from 'lucide-vue-next'
import { DAY, formatClock, formatDayLabel, formatDuration, formatOffset, MINUTE, startOfDay } from '@/core/time'
import { useFeedStore } from '../store'
import { useFeedActions } from '../useFeedActions'
import RhythmStrip from '../components/RhythmStrip.vue'
import FeedEditSheet from '../components/FeedEditSheet.vue'
import { GAP_RATIO } from '../logic/rhythm'
import { KIND_LABEL, type FeedEntry } from '../logic/types'

const store = useFeedStore()
const { removeFeed } = useFeedActions()
void store.ensureLoaded()

const now = computed(() => store.plan.now)
const daysShown = ref(14)

interface Row {
  f: FeedEntry
  gapMin: number | null
  deltaMin: number | null
}

const rows = computed<Row[]>(() => {
  const feeds = store.feeds
  return feeds.map((f, i) => {
    const prev = feeds[i - 1]
    if (!prev) return { f, gapMin: null, deltaMin: null }
    const gapMin = (f.at - prev.at) / MINUTE
    const planned = prev.plan?.baseMin || null
    const plausible = planned && gapMin <= planned * GAP_RATIO
    return { f, gapMin, deltaMin: plausible ? Math.round(gapMin - planned) : null }
  })
})

const groups = computed(() => {
  const cutoff = startOfDay(now.value) - (daysShown.value - 1) * DAY
  const map = new Map<number, Row[]>()
  for (const row of [...rows.value].reverse()) {
    if (row.f.at < cutoff) break
    const key = startOfDay(row.f.at)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }))
})

const hasOlder = computed(() => {
  const first = store.feeds[0]
  return !!first && first.at < startOfDay(now.value) - (daysShown.value - 1) * DAY
})

const stats = computed(() => {
  const since = now.value - DAY
  const recent = rows.value.filter((r) => r.f.at > since)
  const gaps = recent.map((r) => r.gapMin).filter((g): g is number => g != null)
  return {
    count: recent.length,
    avg: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    longest: gaps.length ? Math.max(...gaps) : null,
  }
})

const editing = ref<FeedEntry | null>(null)
const editOpen = ref(false)
function edit(f: FeedEntry) {
  editing.value = f
  editOpen.value = true
}
</script>

<template>
  <div class="page stack">
    <div class="stats">
      <div class="stat">
        <strong class="num">{{ stats.count }}</strong>
        <span>feeds in 24h</span>
      </div>
      <div class="stat">
        <strong class="num">{{ stats.avg != null ? formatDuration(stats.avg) : '—' }}</strong>
        <span>average gap</span>
      </div>
      <div class="stat">
        <strong class="num">{{ stats.longest != null ? formatDuration(stats.longest) : '—' }}</strong>
        <span>longest gap</span>
      </div>
    </div>

    <section class="card">
      <div class="row" style="margin-bottom: 8px">
        <h2 class="card-title">Rhythm · last 7 days</h2>
        <span class="spacer" />
        <span class="tiny faint">night shaded</span>
      </div>
      <RhythmStrip :feeds="store.feeds" :now="now" />
    </section>

    <template v-for="g in groups" :key="g.day">
      <h2 class="section-title">{{ formatDayLabel(g.day, now) }} · {{ g.items.length }}</h2>
      <div class="list">
        <button v-for="r in g.items" :key="r.f.id" class="list-item" @click="edit(r.f)">
          <div class="time num">{{ formatClock(r.f.at) }}</div>
          <div class="grow">
            <div class="row" style="gap: 6px">
              <span v-if="r.gapMin != null" class="small muted num">after {{ formatDuration(r.gapMin) }}</span>
              <span v-else class="small faint">first logged feed</span>
              <span
                v-if="r.deltaMin"
                class="delta num"
                :class="{ late: r.deltaMin > 0 }"
                :title="'Compared with the planned interval by age/manual setting'"
                >{{ formatOffset(r.deltaMin) }}</span
              >
            </div>
            <p v-if="r.f.note" class="tiny faint note"><StickyNote :size="11" /> {{ r.f.note }}</p>
          </div>
          <Bell v-if="r.f.source === 'notification'" :size="15" class="faint" aria-label="Logged from notification" />
          <span v-if="r.f.kind" class="chip">{{ KIND_LABEL[r.f.kind] }}</span>
        </button>
      </div>
    </template>

    <p v-if="!groups.length" class="muted small empty">No feeds in this period.</p>
    <button v-if="hasOlder" class="btn block" @click="daysShown += 14">Show older</button>
  </div>

  <FeedEditSheet
    v-model="editOpen"
    :entry="editing"
    @save="(e) => store.update(e)"
    @delete="(id) => removeFeed(id)"
  />
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  padding: 14px 12px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.stat strong {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.01em;
}

.stat span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.card-title {
  font-size: 15px;
  font-weight: 850;
}

.time {
  font-size: 20px;
  font-weight: 900;
  min-width: 64px;
}

.delta {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  background: var(--info-soft);
  color: var(--info);
}

.delta.late {
  background: var(--accent-soft);
  color: color-mix(in oklab, var(--accent) 75%, var(--text));
}

.note {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  text-align: center;
  padding: 24px 0;
}
</style>
