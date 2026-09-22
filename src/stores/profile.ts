import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getDB, kvSet } from '@/core/db'
import { PROFILE_KEY, readProfile, type Profile } from '@/core/profile'
import { emitChange, onChange } from '@/core/sync'
import { ageInfo, nextMilestone } from '@/core/age'
import { useNow } from '@/composables/useNow'

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<Profile | null>(null)
  const loaded = ref(false)
  const now = useNow()

  const age = computed(() => (profile.value ? ageInfo(profile.value.birthDate, new Date(now.value)) : null))
  const milestone = computed(() =>
    profile.value ? nextMilestone(profile.value.birthDate, new Date(now.value)) : null,
  )
  const displayName = computed(() => profile.value?.name.trim() || 'Baby')

  async function load() {
    profile.value = await readProfile(await getDB())
    loaded.value = true
  }

  async function save(next: Profile) {
    await kvSet(PROFILE_KEY, next)
    profile.value = next
    emitChange('profile')
  }

  onChange((e) => {
    if (e.scope === 'all' || (!e.local && e.scope === 'profile')) void load()
  })

  return { profile, loaded, age, milestone, displayName, load, save }
})
