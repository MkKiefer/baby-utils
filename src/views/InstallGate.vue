<script setup lang="ts">
import { computed, ref } from 'vue'
import { BellRing, ChevronDown, Download, HardDrive, Smartphone, TriangleAlert, WifiOff } from 'lucide-vue-next'
import { canBypassInstall, detectPlatform, setInstallBypass } from '@/core/platform'
import { installState, promptInstall } from '@/core/pwa'
import { guideFor, INSTALL_GUIDES } from './installGuides'

const emit = defineEmits<{ bypass: [] }>()

const platform = detectPlatform()
const detected = guideFor(platform)
const others = computed(() => INSTALL_GUIDES.filter((g) => g.id !== detected?.id))
const openGuide = ref<string | null>(null)

function bypass() {
  setInstallBypass(true)
  emit('bypass')
}
</script>

<template>
  <div class="gate page">
    <header class="intro">
      <img src="/logo.svg" alt="" class="logo" width="88" height="88" />
      <h1>Install Baby Utils</h1>
      <p class="muted">This app works as an installed app on your phone or computer. It takes a few seconds and needs no store or account.</p>
    </header>

    <ul class="why">
      <li><BellRing :size="20" /> <span><b>Reminders</b> need the installed app (required on iPhone).</span></li>
      <li><WifiOff :size="20" /> <span><b>Works offline</b>, full screen, like a native app.</span></li>
      <li><HardDrive :size="20" /> <span><b>Private:</b> data stays in the app's storage on this device.</span></li>
    </ul>

    <div v-if="installState.justInstalled" class="callout accent">
      <Smartphone :size="20" />
      <div><strong>Installed!</strong> Open Baby Utils from your home screen or app list to continue.</div>
    </div>

    <button v-else-if="installState.canPrompt" class="btn primary block lg" @click="promptInstall">
      <Download :size="22" /> Install app
    </button>

    <section v-if="detected" class="guide card" :class="{ unsupported: detected.unsupported }">
      <p class="tiny faint detected">Detected: your device</p>
      <h2>
        <TriangleAlert v-if="detected.unsupported" :size="20" />
        {{ detected.title }}
      </h2>
      <ol>
        <li v-for="(s, i) in detected.steps" :key="i">{{ s }}</li>
      </ol>
      <p v-if="detected.note" class="tiny muted">{{ detected.note }}</p>
    </section>

    <h2 class="section-title">{{ detected ? 'Other devices' : 'Choose your device' }}</h2>
    <div class="list">
      <div v-for="g in others" :key="g.id" class="other">
        <button class="list-item" :aria-expanded="openGuide === g.id" @click="openGuide = openGuide === g.id ? null : g.id">
          <span class="grow">{{ g.title }}</span>
          <ChevronDown :size="18" class="chev" :class="{ open: openGuide === g.id }" />
        </button>
        <div v-if="openGuide === g.id" class="other-body">
          <ol>
            <li v-for="(s, i) in g.steps" :key="i">{{ s }}</li>
          </ol>
          <p v-if="g.note" class="tiny muted">{{ g.note }}</p>
        </div>
      </div>
    </div>

    <button v-if="canBypassInstall()" class="btn ghost block bypass" @click="bypass">Continue in the browser (developer)</button>
  </div>
</template>

<style scoped>
.gate {
  padding-top: calc(28px + var(--safe-top));
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.intro {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.logo {
  border-radius: 24px;
  box-shadow: 0 16px 40px -16px rgba(255, 122, 97, 0.7);
  margin-bottom: 6px;
}

h1 {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.why {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.why li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 15px;
  color: var(--text-2);
}

.why svg {
  flex: none;
  color: var(--accent);
  margin-top: 1px;
}

.guide {
  border: 2px solid var(--accent);
}

.guide.unsupported {
  border-color: var(--warn);
}

.detected {
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.guide h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 19px;
  font-weight: 900;
  margin: 2px 0 8px;
}

ol {
  margin: 0 0 8px;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

li::marker {
  font-weight: 900;
  color: var(--accent);
}

.other + .other {
  border-top: 1px solid var(--line);
}

.other .list-item + .list-item {
  border: 0;
}

.other-body {
  padding: 0 16px 14px;
  font-size: 15px;
}

.chev {
  color: var(--text-3);
  transition: transform 0.2s;
}

.chev.open {
  transform: rotate(180deg);
}

.bypass {
  margin-top: 8px;
  font-size: 14px;
}
</style>
