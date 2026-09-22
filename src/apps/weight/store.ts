import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getDB } from '@/core/db'
import { emitChange, onChange } from '@/core/sync'
import { useProfileStore } from '@/stores/profile'
import {
  addWeight,
  birthMoment,
  deleteWeight,
  putWeight,
  readAllWeights,
  readWeightSettings,
  restoreWeight,
  writeWeightSettings,
  type NewWeight,
} from './logic/repo'
import { computeWeightStats, sortWeights } from './logic/stats'
import { DEFAULT_WEIGHT_SETTINGS, type WeightEntry, type WeightSettings } from './logic/types'

export const useWeightStore = defineStore('weight', () => {
  const weights = ref<WeightEntry[]>([])
  const settings = ref<WeightSettings>({ ...DEFAULT_WEIGHT_SETTINGS })
  const loaded = ref(false)
  const profileStore = useProfileStore()

  const birthMs = computed(() => birthMoment(profileStore.profile))
  const stats = computed(() => computeWeightStats(weights.value, birthMs.value))
  const unit = computed(() => settings.value.unit)

  let loading: Promise<void> | null = null

  async function load() {
    const db = await getDB()
    const [all, s] = await Promise.all([readAllWeights(db), readWeightSettings(db)])
    weights.value = sortWeights(all)
    settings.value = s
    loaded.value = true
  }

  function ensureLoaded() {
    loading ??= load()
    return loading
  }

  async function add(input: NewWeight) {
    const entry = await addWeight(await getDB(), input)
    weights.value = sortWeights([...weights.value, entry])
    emitChange('weights')
    return entry
  }

  async function update(entry: WeightEntry) {
    const saved = await putWeight(await getDB(), entry)
    weights.value = sortWeights(weights.value.map((e) => (e.id === saved.id ? saved : e)))
    emitChange('weights')
  }

  async function remove(id: string) {
    const entry = weights.value.find((e) => e.id === id)
    await deleteWeight(await getDB(), id)
    weights.value = weights.value.filter((e) => e.id !== id)
    emitChange('weights')
    return entry
  }

  async function restore(entry: WeightEntry) {
    const saved = await restoreWeight(await getDB(), entry)
    weights.value = sortWeights([...weights.value.filter((e) => e.id !== saved.id), saved])
    emitChange('weights')
  }

  async function saveSettings(patch: Partial<WeightSettings>) {
    settings.value = { ...settings.value, ...patch }
    await writeWeightSettings(await getDB(), settings.value)
    emitChange('weight.settings')
  }

  onChange((e) => {
    if (e.scope === 'all' || (!e.local && (e.scope === 'weights' || e.scope === 'weight.settings'))) {
      loading = load()
    }
  })

  return { weights, settings, unit, loaded, birthMs, stats, ensureLoaded, add, update, remove, restore, saveSettings }
})
