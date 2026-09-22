<script setup lang="ts">
import { ref } from 'vue'
import { detectPlatform, installBypassed } from '@/core/platform'
import { subApps } from '@/apps/registry'

const info = ref(collect())

function collect() {
  const p = detectPlatform()
  const nav = navigator as Navigator & Record<string, unknown>
  const has = (v: unknown) => (v ? 'yes' : 'no')
  return {
    app: { version: __APP_VERSION__, built: __BUILD_TIME__, mode: import.meta.env.MODE },
    platform: {
      os: p.os,
      browser: p.browser,
      mobile: p.mobile,
      standalone: p.standalone,
      displayMode: p.displayMode,
      installGateBypassed: installBypassed(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: navigator.onLine,
      screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
      viewport: `${innerWidth}×${innerHeight}`,
    },
    features: {
      serviceWorker: has('serviceWorker' in navigator),
      indexedDB: has(typeof indexedDB !== 'undefined'),
      notifications: has(typeof Notification !== 'undefined'),
      notificationActions: has(typeof Notification !== 'undefined' && 'maxActions' in Notification),
      broadcastChannel: has(typeof BroadcastChannel !== 'undefined'),
      storagePersist: has(navigator.storage?.persist),
      appBadge: has(nav.setAppBadge),
      wakeLock: has('wakeLock' in navigator),
      periodicSync: has(typeof ServiceWorkerRegistration !== 'undefined' && 'periodicSync' in ServiceWorkerRegistration.prototype),
      webShareFiles: has(navigator.canShare),
      vibrate: has(navigator.vibrate),
      webAudio: has(window.AudioContext),
      cacheStorage: has(typeof caches !== 'undefined'),
    },
  }
}
</script>

<template>
  <div class="row">
    <span class="spacer" />
    <button class="btn sm" @click="info = collect()">Refresh</button>
  </div>
  <table>
    <tbody>
      <tr v-for="(v, k) in info.app" :key="k">
        <th>{{ k }}</th>
        <td>
          <code>{{ v }}</code>
        </td>
      </tr>
      <tr v-for="(v, k) in info.platform" :key="k">
        <th>{{ k }}</th>
        <td>
          <code>{{ v }}</code>
        </td>
      </tr>
    </tbody>
  </table>
  <strong class="small">Feature support</strong>
  <table>
    <tbody>
      <tr v-for="(v, k) in info.features" :key="k">
        <th>{{ k }}</th>
        <td :class="v === 'yes' ? 'yes' : 'no'">{{ v }}</td>
      </tr>
    </tbody>
  </table>
  <strong class="small">Registered sub-apps</strong>
  <table>
    <tbody>
      <tr v-for="a in subApps" :key="a.id">
        <th>{{ a.id }}</th>
        <td>{{ a.name }} · {{ a.routes.length }} routes · {{ a.debugSections?.length ?? 0 }} debug sections</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.yes {
  color: var(--ok);
  font-weight: 800;
}

.no {
  color: var(--text-3);
}
</style>
