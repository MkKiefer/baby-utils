import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import { getDB } from '@/core/db'
import { emitChange, onChange } from '@/core/sync'
import { MINUTE } from '@/core/time'
import { ageDays } from '@/core/age'
import { useProfileStore } from '@/stores/profile'
import { addDiaper, deleteDiaper, putDiaper, readAllDiapers, restoreDiaper, type NewDiaper } from './logic/repo'
import { computeDiaperStats, expectedPerDay, sortDiapers } from './logic/stats'
import type { DiaperEntry } from './logic/types'

export const useDiaperStore = defineStore('diaper', () => {
  const diapers = ref<DiaperEntry[]>([])
  const loaded = ref(false)
  const profileStore = useProfileStore()

  // "Today" and "ago" move with the clock, not only with edits.
  const now = ref(Date.now())
  const timer = setInterval(() => (now.value = Date.now()), MINUTE)
  onScopeDispose(() => clearInterval(timer))

  const stats = computed(() => computeDiaperStats(diapers.value, now.value))
  const expected = computed(() => {
    const birth = profileStore.profile?.birthDate
    return birth ? expectedPerDay(ageDays(birth, now.value)) : null
  })

  let loading: Promise<void> | null = null

  async function load() {
    diapers.value = sortDiapers(await readAllDiapers(await getDB()))
    loaded.value = true
  }

  function ensureLoaded() {
    loading ??= load()
    return loading
  }

  function touch() {
    now.value = Date.now()
    emitChange('diapers')
  }

  async function add(input: NewDiaper) {
    const entry = await addDiaper(await getDB(), input)
    diapers.value = sortDiapers([...diapers.value, entry])
    touch()
    return entry
  }

  async function update(entry: DiaperEntry) {
    const saved = await putDiaper(await getDB(), entry)
    diapers.value = sortDiapers(diapers.value.map((e) => (e.id === saved.id ? saved : e)))
    touch()
    return saved
  }

  async function remove(id: string) {
    const entry = diapers.value.find((e) => e.id === id)
    await deleteDiaper(await getDB(), id)
    diapers.value = diapers.value.filter((e) => e.id !== id)
    touch()
    return entry
  }

  async function restore(entry: DiaperEntry) {
    const saved = await restoreDiaper(await getDB(), entry)
    diapers.value = sortDiapers([...diapers.value.filter((e) => e.id !== saved.id), saved])
    touch()
  }

  onChange((e) => {
    if (e.scope === 'all' || (!e.local && e.scope === 'diapers')) loading = load()
  })

  return { diapers, loaded, now, stats, expected, ensureLoaded, add, update, remove, restore }
})
