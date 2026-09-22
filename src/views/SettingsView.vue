<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Bug, ChevronRight, Download, Upload } from 'lucide-vue-next'
import AppBar from '@/components/AppBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import { useProfileStore } from '@/stores/profile'
import { setTheme, themeState, type ThemePref } from '@/core/theme'
import { toIsoDate } from '@/core/age'
import { notificationPermission, requestNotificationPermission } from '@/core/notify/permission'
import { formatBytes, refreshStorage, requestPersistence, storageState } from '@/core/storage'
import { exportBackupFile, parseBackup, restoreBackup, wipeAllData } from '@/core/backup'
import { isStandalone } from '@/core/platform'
import { toast } from '@/composables/useToast'
import { useRouter } from 'vue-router'

const profileStore = useProfileStore()
const router = useRouter()
const today = toIsoDate(new Date())
const version = __APP_VERSION__
const installed = isStandalone()

const name = ref(profileStore.profile?.name ?? '')
const birthDate = ref(profileStore.profile?.birthDate ?? '')
const birthTime = ref(profileStore.profile?.birthTime ?? '')

watch(
  () => profileStore.profile,
  (p) => {
    name.value = p?.name ?? ''
    birthDate.value = p?.birthDate ?? ''
    birthTime.value = p?.birthTime ?? ''
  },
)

async function saveProfile() {
  const p = profileStore.profile
  if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate.value) || birthDate.value > today) return
  const next = { ...p, name: name.value.trim(), birthDate: birthDate.value }
  if (birthTime.value) next.birthTime = birthTime.value
  else delete next.birthTime
  if (JSON.stringify(next) === JSON.stringify(p)) return
  await profileStore.save(next)
  toast('Saved', { tone: 'ok' })
}

const theme = ref<ThemePref>(themeState.pref)
watch(theme, (t) => setTheme(t))

const fileInput = ref<HTMLInputElement>()

async function doExport() {
  const result = await exportBackupFile()
  if (result !== 'cancelled') toast(result === 'shared' ? 'Backup shared' : 'Backup downloaded', { tone: 'ok' })
}

async function doImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const backup = parseBackup(await file.text())
    await restoreBackup(backup)
    toast(`Restored backup from ${new Date(backup.exportedAt).toLocaleString()}`, { tone: 'ok' })
  } catch (err) {
    toast(String((err as Error).message ?? err), { tone: 'warn' })
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function wipe() {
  await wipeAllData()
  await profileStore.load()
  await router.replace('/setup')
}

onMounted(refreshStorage)
</script>

<template>
  <AppBar title="Settings" back="/" />
  <div class="page">
    <h2 class="section-title">Baby</h2>
    <div class="card stack">
      <label class="field">
        <span>Name</span>
        <input v-model="name" class="input" type="text" maxlength="40" placeholder="Baby" @change="saveProfile" />
      </label>
      <div class="two">
        <label class="field">
          <span>Birth date</span>
          <input v-model="birthDate" class="input" type="date" :max="today" @change="saveProfile" />
        </label>
        <label class="field">
          <span>Time</span>
          <input v-model="birthTime" class="input" type="time" @change="saveProfile" />
        </label>
      </div>
    </div>

    <h2 class="section-title">Appearance</h2>
    <SegmentedControl
      v-model="theme"
      label="Theme"
      :options="[
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]"
    />

    <h2 class="section-title">Notifications</h2>
    <div class="list">
      <div class="list-item">
        <div class="grow">
          <strong>Permission</strong>
          <p class="small muted">{{ notificationPermission }}</p>
        </div>
        <button v-if="notificationPermission === 'default'" class="btn sm primary" @click="requestNotificationPermission">
          Allow
        </button>
      </div>
      <p v-if="notificationPermission === 'denied'" class="list-item small muted">
        Blocked. Re-enable notifications for Baby Utils in your system or browser settings.
      </p>
    </div>

    <h2 class="section-title">Data &amp; privacy</h2>
    <div class="list">
      <div class="list-item">
        <div class="grow">
          <strong>Protected storage</strong>
          <p class="small muted">
            {{
              storageState.persisted
                ? 'On — the browser will not clear this data on its own.'
                : 'Off — the browser may clear data when storage runs low.'
            }}
            Using {{ formatBytes(storageState.usage) }}.
          </p>
        </div>
        <button v-if="!storageState.persisted && storageState.supported" class="btn sm" @click="requestPersistence">
          Protect
        </button>
      </div>
      <button class="list-item" @click="doExport">
        <Download :size="20" />
        <span class="grow"><strong>Export backup</strong><br /><span class="small muted">JSON file with all data</span></span>
      </button>
      <button class="list-item" @click="fileInput?.click()">
        <Upload :size="20" />
        <span class="grow"><strong>Restore backup</strong><br /><span class="small muted">Replaces all current data</span></span>
      </button>
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="doImport" />
      <RouterLink to="/app/debug" class="list-item" style="text-decoration: none">
        <Bug :size="20" />
        <span class="grow"><strong>Debug</strong><br /><span class="small muted">Inspect everything stored on this device</span></span>
        <ChevronRight :size="18" class="faint" />
      </RouterLink>
    </div>
    <div style="margin-top: 16px">
      <ConfirmButton label="Delete all data" confirm-label="Tap again — this cannot be undone" class="block" @confirm="wipe" />
    </div>

    <p class="tiny faint about">
      Baby Utils {{ version }} · {{ installed ? 'installed app' : 'browser tab' }}<br />
      Not medical advice. Always follow your midwife or paediatrician.
    </p>
  </div>
</template>

<style scoped>
.two {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 10px;
}

.about {
  text-align: center;
  margin-top: 24px;
}
</style>
