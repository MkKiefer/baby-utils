<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, StickyNote } from 'lucide-vue-next'
import { DAY, formatClock, formatDayLabel, startOfDay } from '@/core/time'
import { useMedsStore } from '../store'
import { useMedsActions } from '../useMedsActions'
import DoseSheet from '../components/DoseSheet.vue'
import type { MedDose } from '../logic/types'

/** Every dose, newest first, grouped by day; optionally one medication only. */
const store = useMedsStore()
const actions = useMedsActions()
void store.ensureLoaded()

const filter = ref<string | null>(null)
const daysShown = ref(14)
const cutoff = computed(() => startOfDay(store.now) - (daysShown.value - 1) * DAY)
const filtered = computed(() => (filter.value ? store.doses.filter((d) => d.planId === filter.value) : store.doses))

const groups = computed(() => {
  const map = new Map<number, MedDose[]>()
  for (const d of [...filtered.value].reverse()) {
    if (d.at < cutoff.value) break
    const key = startOfDay(d.at)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(d)
  }
  return [...map.entries()].map(([day, items]) => ({ day, items, given: items.filter((d) => !d.skipped).length }))
})

const hasOlder = computed(() => {
  const first = filtered.value[0]
  return !!first && first.at < cutoff.value
})

const nameOf = (d: MedDose) => store.planById(d.planId)?.name ?? d.name
const amountOf = (d: MedDose) => store.planById(d.planId)?.dose ?? d.dose

const sheetOpen = ref(false)
const editing = ref<MedDose | null>(null)
function edit(d: MedDose | null) {
  editing.value = d
  sheetOpen.value = true
}
</script>

<template>
  <div class="page stack">
    <button class="btn primary block" :disabled="!store.plans.length" @click="edit(null)"><Plus :size="18" /> Log dose</button>

    <div v-if="store.plans.length > 1" class="filters">
      <button class="chip" :class="{ accent: !filter }" @click="filter = null">All</button>
      <button v-for="p in store.plans" :key="p.id" class="chip" :class="{ accent: filter === p.id }" @click="filter = p.id">
        {{ p.name }}
      </button>
    </div>

    <template v-if="groups.length">
      <section v-for="g in groups" :key="g.day" class="stack day">
        <div class="row day-head">
          <h2 class="section-title" style="margin: 0 6px">{{ formatDayLabel(g.day) }}</h2>
          <span class="spacer" />
          <span class="small muted num">{{ g.given }} given</span>
        </div>
        <div class="list">
          <button v-for="d in g.items" :key="d.id" class="list-item" title="Edit dose" @click="edit(d)">
            <strong class="num time" :class="{ faint: d.skipped }">{{ formatClock(d.at) }}</strong>
            <div class="grow">
              <strong :class="{ struck: d.skipped }">{{ nameOf(d) }}</strong>
              <span v-if="amountOf(d)" class="muted small"> · {{ amountOf(d) }}</span>
              <p v-if="d.note" class="tiny faint note"><StickyNote :size="11" /> {{ d.note }}</p>
            </div>
            <span v-if="d.skipped" class="chip warn">Skipped</span>
            <Pencil :size="15" class="faint" aria-hidden="true" />
          </button>
        </div>
      </section>
      <button v-if="hasOlder" class="btn ghost block" @click="daysShown += 14">Show older</button>
    </template>
    <p v-else class="muted small empty">No doses logged yet.</p>
  </div>

  <DoseSheet
    v-model="sheetOpen"
    :dose="editing"
    :plans="store.plans"
    @add="actions.logDose"
    @save="actions.saveDose"
    @delete="actions.removeDose"
  />
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filters .chip {
  min-height: 32px;
}

.day {
  gap: 8px;
}

.day-head {
  margin-top: 6px;
}

.time {
  min-width: 48px;
  font-size: 15px;
  font-weight: 900;
}

.struck {
  text-decoration: line-through;
  color: var(--text-3);
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
