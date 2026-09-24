<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, StickyNote } from 'lucide-vue-next'
import { DAY, formatClock, formatDayLabel, startOfDay } from '@/core/time'
import { useDiaperStore } from '../store'
import { useDiaperActions } from '../useDiaperActions'
import DiaperEditSheet from '../components/DiaperEditSheet.vue'
import { isDirty, isWarnStool, isWet, KIND_LABEL, STOOL_COLORS, stoolLabel, type DiaperEntry } from '../logic/types'

/** Every diaper, newest first, grouped by day with the day's counts. */
const store = useDiaperStore()
const { logDiaper, saveDiaper, removeDiaper } = useDiaperActions()
void store.ensureLoaded()

const daysShown = ref(14)
const cutoff = computed(() => startOfDay(store.now) - (daysShown.value - 1) * DAY)

const groups = computed(() => {
  const map = new Map<number, DiaperEntry[]>()
  for (const e of [...store.diapers].reverse()) {
    if (e.at < cutoff.value) break
    const key = startOfDay(e.at)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return [...map.entries()].map(([day, items]) => ({
    day,
    items,
    wet: items.filter(isWet).length,
    dirty: items.filter(isDirty).length,
  }))
})

const hasOlder = computed(() => {
  const first = store.diapers[0]
  return !!first && first.at < cutoff.value
})

const sheetOpen = ref(false)
const editing = ref<DiaperEntry | null>(null)
function edit(e: DiaperEntry | null) {
  editing.value = e
  sheetOpen.value = true
}

const swatch = (e: DiaperEntry) => STOOL_COLORS.find((c) => c.value === e.stool)?.swatch
</script>

<template>
  <div class="page stack">
    <button class="btn primary block" @click="edit(null)"><Plus :size="18" /> Log diaper</button>
    <template v-if="groups.length">
      <section v-for="g in groups" :key="g.day" class="stack day">
        <div class="row day-head">
          <h2 class="section-title" style="margin: 0 6px">{{ formatDayLabel(g.day) }}</h2>
          <span class="spacer" />
          <span class="small muted num">{{ g.wet }} wet · {{ g.dirty }} dirty</span>
        </div>
        <div class="list">
          <button v-for="e in g.items" :key="e.id" class="list-item" title="Edit diaper" @click="edit(e)">
            <strong class="num time">{{ formatClock(e.at) }}</strong>
            <div class="grow">
              <strong>{{ KIND_LABEL[e.kind] }}</strong>
              <p v-if="e.note" class="tiny faint note"><StickyNote :size="11" /> {{ e.note }}</p>
            </div>
            <span v-if="e.stool" class="chip" :class="{ warn: isWarnStool(e.stool) }">
              <i class="swatch" :style="{ background: swatch(e) }" /> {{ stoolLabel(e.stool) }}
            </span>
            <Pencil :size="15" class="faint" aria-hidden="true" />
          </button>
        </div>
      </section>
      <button v-if="hasOlder" class="btn ghost block" @click="daysShown += 14">Show older</button>
    </template>
    <p v-else class="muted small empty">No diapers logged yet.</p>
  </div>

  <DiaperEditSheet v-model="sheetOpen" :entry="editing" @add="logDiaper" @save="saveDiaper" @delete="removeDiaper" />
</template>

<style scoped>
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

.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
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
