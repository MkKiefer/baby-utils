<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, StickyNote } from 'lucide-vue-next'
import { formatDate, DAY } from '@/core/time'
import { ageDays } from '@/core/age'
import { useProfileStore } from '@/stores/profile'
import { formatChange, formatWeight } from '../logic/format'
import { useWeightStore } from '../store'
import { useWeightActions } from '../useWeightActions'
import WeightEditSheet from '../components/WeightEditSheet.vue'
import type { WeightEntry } from '../logic/types'

/** Every weighing, newest first, with the change since the one before. */
const store = useWeightStore()
const profile = useProfileStore()
const { addWeighing, saveWeighing, removeWeighing } = useWeightActions()
void store.ensureLoaded()

const rows = computed(() => {
  const list = store.weights
  return list
    .map((e, i) => {
      const prev = list[i - 1]
      const days = prev ? (e.at - prev.at) / DAY : null
      return {
        e,
        change: prev ? e.grams - prev.grams : null,
        days,
        age: profile.profile ? ageDays(profile.profile.birthDate, e.at) : null,
      }
    })
    .reverse()
})

const sheetOpen = ref(false)
const editing = ref<WeightEntry | null>(null)
function edit(e: WeightEntry | null) {
  editing.value = e
  sheetOpen.value = true
}
const previousOf = computed(() => {
  if (!editing.value) return store.stats.latest
  const i = store.weights.findIndex((e) => e.id === editing.value!.id)
  return i > 0 ? store.weights[i - 1] : null
})

function ageLabel(days: number): string {
  if (days < 0) return 'before birth'
  if (days < 14) return `day ${days}`
  if (days < 91) return `week ${Math.floor(days / 7)}`
  return `${Math.floor(days / 30.44)} mo`
}
</script>

<template>
  <div class="page stack">
    <button class="btn primary block" @click="edit(null)"><Plus :size="18" /> Log weight</button>
    <div v-if="rows.length" class="list">
      <button v-for="r in rows" :key="r.e.id" class="list-item" title="Edit weighing" @click="edit(r.e)">
        <div class="grow">
          <div class="row" style="gap: 8px">
            <strong class="num weight">{{ formatWeight(r.e.grams, store.unit) }}</strong>
            <span
              v-if="r.change != null"
              class="delta num"
              :class="{ down: r.change < 0 }"
              :title="r.days != null ? `over ${r.days.toFixed(1)} days` : undefined"
              >{{ formatChange(r.change, store.unit) }}</span
            >
          </div>
          <span class="small muted num">
            {{ formatDate(r.e.at) }}<template v-if="r.age != null"> · {{ ageLabel(r.age) }}</template>
          </span>
          <p v-if="r.e.note" class="tiny faint note"><StickyNote :size="11" /> {{ r.e.note }}</p>
        </div>
        <span v-if="store.stats.birth?.id === r.e.id" class="chip">Birth</span>
        <Pencil :size="15" class="faint" aria-hidden="true" />
      </button>
    </div>
    <p v-else class="muted small empty">No weighings yet.</p>
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
.weight {
  font-size: 18px;
  font-weight: 900;
}

.delta {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  background: var(--accent-soft);
  color: color-mix(in oklab, var(--accent) 75%, var(--text));
}

.delta.down {
  background: var(--surface-3);
  color: var(--text-2);
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
