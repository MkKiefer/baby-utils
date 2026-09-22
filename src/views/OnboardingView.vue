<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, BellRing, Check, HardDrive, Lock, Timer } from 'lucide-vue-next'
import { ageInfo, toIsoDate } from '@/core/age'
import { notificationPermission, requestNotificationPermission } from '@/core/notify/permission'
import { requestPersistence } from '@/core/storage'
import { refreshSchedule } from '@/core/notify/scheduler'
import { useProfileStore } from '@/stores/profile'

const router = useRouter()
const profile = useProfileStore()

const step = ref(0)
const name = ref('')
const birthDate = ref('')
const birthTime = ref('')
const saving = ref(false)
const today = toIsoDate(new Date())

const validDate = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(birthDate.value) && birthDate.value <= today)
const preview = computed(() => (validDate.value ? ageInfo(birthDate.value) : null))

async function finish() {
  saving.value = true
  try {
    await profile.save({
      name: name.value.trim(),
      birthDate: birthDate.value,
      ...(birthTime.value ? { birthTime: birthTime.value } : {}),
      createdAt: Date.now(),
    })
    // Ask the browser to protect our data from eviction; silently ignored where unsupported.
    await requestPersistence().catch(() => false)
    void refreshSchedule()
    await router.replace('/')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="onboarding page">
    <div class="progress" aria-hidden="true">
      <span v-for="i in 3" :key="i" :class="{ on: step >= i - 1 }" />
    </div>

    <Transition name="fade" mode="out-in">
      <!-- ------------------------------------------------------------ welcome -->
      <section v-if="step === 0" key="0" class="step">
        <img src="/logo.svg" alt="" width="96" height="96" class="logo" />
        <h1>Welcome</h1>
        <p class="lead muted">Small, calm helpers for the first months. Let's set things up — it takes a minute.</p>
        <ul class="points">
          <li><Timer :size="20" /> Feed timer that learns your baby's rhythm</li>
          <li><Lock :size="20" /> No account, no cloud — everything stays on this device</li>
          <li><HardDrive :size="20" /> Export a backup any time in Settings</li>
        </ul>
        <button class="btn primary block lg" @click="step = 1">Get started</button>
      </section>

      <!-- ------------------------------------------------------------ baby -->
      <section v-else-if="step === 1" key="1" class="step">
        <h1>About your baby</h1>
        <p class="lead muted">The birth date sets the age shown on the home screen and the default feeding interval.</p>
        <label class="field">
          <span>Name (optional)</span>
          <input v-model="name" class="input" type="text" autocomplete="off" placeholder="e.g. Mila" maxlength="40" />
        </label>
        <label class="field">
          <span>Birth date</span>
          <input v-model="birthDate" class="input" type="date" :max="today" required />
        </label>
        <label class="field">
          <span>Time of birth (optional)</span>
          <input v-model="birthTime" class="input" type="time" />
        </label>
        <div v-if="preview" class="preview">
          <span class="tiny faint">That's</span>
          <strong>{{ preview.primary }}</strong>
          <span class="tiny muted">{{ preview.days }} days old</span>
        </div>
        <div class="nav">
          <button class="btn ghost" @click="step = 0"><ArrowLeft :size="18" /> Back</button>
          <button class="btn primary grow" :disabled="!validDate" @click="step = 2">Continue</button>
        </div>
      </section>

      <!-- ------------------------------------------------------------ notifications -->
      <section v-else key="2" class="step">
        <div class="bell"><BellRing :size="40" /></div>
        <h1>Reminders</h1>
        <p class="lead muted">
          The feed timer can notify you when it's time to feed. Notifications are created on this device; nothing is
          sent to a server.
        </p>
        <div v-if="notificationPermission === 'granted'" class="callout accent">
          <Check :size="20" /> <span><strong>Notifications allowed.</strong></span>
        </div>
        <div v-else-if="notificationPermission === 'denied'" class="callout warn">
          <span>Notifications are blocked. You can allow them later in the system settings for this app.</span>
        </div>
        <div v-else-if="notificationPermission === 'unsupported'" class="callout">
          <span>This browser does not support notifications. Night mode still chimes while the app is open.</span>
        </div>
        <button
          v-else
          class="btn primary block lg"
          @click="requestNotificationPermission"
        >
          Allow notifications
        </button>
        <div class="nav">
          <button class="btn ghost" @click="step = 1"><ArrowLeft :size="18" /> Back</button>
          <button class="btn grow" :class="{ primary: notificationPermission !== 'default' }" :disabled="saving" @click="finish">
            {{ notificationPermission === 'default' ? 'Skip for now' : 'Finish' }}
          </button>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.onboarding {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding-top: calc(20px + var(--safe-top));
}

.progress {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-bottom: 24px;
}

.progress span {
  width: 28px;
  height: 5px;
  border-radius: 3px;
  background: var(--line-2);
  transition: background 0.3s;
}

.progress span.on {
  background: var(--accent);
}

.step {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.logo {
  border-radius: 26px;
  align-self: center;
  margin: 10px 0;
  box-shadow: 0 16px 40px -16px rgba(255, 122, 97, 0.7);
}

h1 {
  font-size: 30px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.lead {
  font-size: 16px;
}

.points {
  list-style: none;
  margin: 8px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.points li {
  display: flex;
  gap: 12px;
  font-weight: 700;
}

.points svg {
  flex: none;
  color: var(--accent);
}

.preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--accent-soft);
}

.preview strong {
  font-size: 26px;
  font-weight: 900;
}

.bell {
  align-self: center;
  display: grid;
  place-items: center;
  width: 88px;
  height: 88px;
  border-radius: 30px;
  background: var(--accent-soft);
  color: var(--accent);
  margin: 10px 0;
}

.nav {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 16px;
}

.grow {
  flex: 1;
}
</style>
