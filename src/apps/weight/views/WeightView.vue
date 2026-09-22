<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Info, PartyPopper, Plus, StickyNote } from 'lucide-vue-next'
import { formatDayLabel, formatShortDate } from '@/core/time'
import { formatChange, formatWeight } from '../logic/format'
import { useWeightStore } from '../store'
import { useWeightActions } from '../useWeightActions'
import WeightChart from '../components/WeightChart.vue'
import WeightEditSheet from '../components/WeightEditSheet.vue'
import type { WeightEntry } from '../logic/types'

const store = useWeightStore()
const { addWeighing, saveWeighing, removeWeighing } = useWeightActions()
void store.ensureLoaded()

const stats = computed(() => store.stats)
const recent = computed(() => [...store.weights].reverse().slice(0, 5))

const sheetOpen = ref(false)
const editing = ref<WeightEntry | null>(null)
function openAdd() {
  editing.value = null
  sheetOpen.value = true
}
function edit(e: WeightEntry) {
  editing.value = e
  sheetOpen.value = true
}
/** The weighing before the one being edited (or the latest, when adding). */
const previousOf = computed(() => {
  if (!editing.value) return stats.value.latest
  const i = store.weights.findIndex((e) => e.id === editing.value!.id)
  return i > 0 ? store.weights[i - 1] : null
})

const belowBirth = computed(() => {
  const pct = stats.value.vsBirthPct
  return pct != null && pct < 0 && !stats.value.regainedAt ? Math.abs(pct) : null
})
</script>

<template>
  <div class="page stack">
    <div class="facts">
      <div class="fact">
        <span class="k">Latest</span>
        <strong class="num">{{ stats.latest ? formatWeight(stats.latest.grams, store.unit) : '—' }}</strong>
        <span class="h">{{ stats.latest ? formatDayLabel(stats.latest.at) : 'none yet' }}</span>
      </div>
      <div class="fact">
        <span class="k">Change</span>
        <strong class="num">{{ stats.change != null ? formatChange(stats.change, store.unit) : '—' }}</strong>
        <span class="h">{{ stats.previous ? `since ${formatShortDate(stats.previous.at)}` : 'needs 2 weighings' }}</span>
      </div>
      <div class="fact">
        <span class="k">Per day</span>
        <strong class="num">{{ stats.rate ? formatChange(stats.rate.gramsPerDay, store.unit) : '—' }}</strong>
        <span class="h">{{ stats.rate ? `since ${formatShortDate(stats.rate.fromAt)}` : 'over a few days' }}</span>
      </div>
    </div>

    <div v-if="belowBirth != null" class="callout info">
      <Info :size="20" />
      <div>
        <strong>{{ belowBirth.toFixed(1) }}% below birth weight.</strong> Most newborns lose some weight in the first days
        and are back to birth weight by about two weeks. Your midwife or paediatrician knows what is right for your baby.
      </div>
    </div>
    <div v-else-if="stats.regainedAt && stats.lowest" class="callout accent">
      <PartyPopper :size="20" />
      <div>
        <strong>Back above birth weight</strong> since {{ formatShortDate(stats.regainedAt) }} — lowest was
        {{ formatWeight(stats.lowest.grams, store.unit) }} on {{ formatShortDate(stats.lowest.at) }}.
      </div>
    </div>

    <section class="card">
      <h2 class="card-title">Weight over time <span class="faint">· {{ store.unit }}</span></h2>
      <WeightChart v-if="store.weights.length >= 2" :weights="store.weights" :unit="store.unit" :birth="stats.birth" />
      <p v-else class="small muted empty">
        {{ store.weights.length ? 'Log one more weighing to see the curve.' : 'Log the first weighing — the birth weight is a good start.' }}
      </p>
    </section>

    <button class="btn primary block lg" @click="openAdd"><Plus :size="20" /> Log weight</button>

    <template v-if="recent.length">
      <div class="row" style="margin-top: 8px">
        <h2 class="section-title" style="margin: 0 6px">Recent</h2>
        <span class="spacer" />
        <RouterLink to="/app/weight/history" class="btn sm ghost">History <ChevronRight :size="16" /></RouterLink>
      </div>
      <div class="list">
        <button v-for="e in recent" :key="e.id" class="list-item" title="Edit weighing" @click="edit(e)">
          <div class="grow">
            <strong class="num">{{ formatWeight(e.grams, store.unit) }}</strong>
            <span class="muted small"> · {{ formatDayLabel(e.at) }}</span>
            <p v-if="e.note" class="tiny faint note"><StickyNote :size="11" /> {{ e.note }}</p>
          </div>
          <span v-if="stats.birth?.id === e.id" class="chip">Birth</span>
        </button>
      </div>
    </template>
  </div>

  <WeightEditSheet
    v-model="sheetOpen"
    :entry="editing"
    :unit="store.unit"
    :previous="previousOf"
    @add="addWeighing"
    @save="saveWeighing"
    @delete="removeWeighing"
  />
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.fact {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 14px 12px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.fact .k,
.fact .h {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.fact .h {
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fact strong {
  font-size: 18px;
  font-weight: 900;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-title {
  font-size: 15px;
  font-weight: 850;
  margin-bottom: 18px;
}

.empty {
  text-align: center;
  padding: 24px 0;
}

.note {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
