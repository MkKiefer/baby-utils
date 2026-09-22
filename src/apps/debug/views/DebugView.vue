<script setup lang="ts">
import { defineAsyncComponent, markRaw, ref, type Component } from 'vue'
import { subApps } from '@/apps/registry'
import DebugPanel from '../components/DebugPanel.vue'
import EnvironmentSection from '../sections/EnvironmentSection.vue'
import IndexedDbSection from '../sections/IndexedDbSection.vue'
import WebStorageSection from '../sections/WebStorageSection.vue'
import CacheSection from '../sections/CacheSection.vue'
import ServiceWorkerSection from '../sections/ServiceWorkerSection.vue'
import NotificationsSection from '../sections/NotificationsSection.vue'
import DeviceApisSection from '../sections/DeviceApisSection.vue'
import NearbySection from '../sections/NearbySection.vue'

/**
 * Every browser feature the app uses has an inspector here. Sub-apps contribute their own
 * sections through `debugSections` in their manifest.
 */
const sections: { id: string; title: string; subtitle?: string; component: Component }[] = [
  { id: 'env', title: 'Environment & support', subtitle: 'platform, features', component: markRaw(EnvironmentSection) },
  { id: 'idb', title: 'IndexedDB', subtitle: 'all app data', component: markRaw(IndexedDbSection) },
  { id: 'ls', title: 'Local & session storage', subtitle: 'UI prefs', component: markRaw(WebStorageSection) },
  { id: 'notify', title: 'Notifications & scheduler', subtitle: 'plan, log', component: markRaw(NotificationsSection) },
  { id: 'sw', title: 'Service worker', subtitle: 'registration', component: markRaw(ServiceWorkerSection) },
  { id: 'cache', title: 'Cache Storage', subtitle: 'offline files', component: markRaw(CacheSection) },
  { id: 'apis', title: 'Device APIs', subtitle: 'storage, permissions, wake lock…', component: markRaw(DeviceApisSection) },
  { id: 'nearby', title: 'Nearby sync (QR)', subtitle: 'camera, codes, payload', component: markRaw(NearbySection) },
  ...subApps.flatMap((app) =>
    (app.debugSections ?? []).map((s) => ({
      id: `${app.id}:${s.id}`,
      title: s.title,
      subtitle: app.name,
      component: markRaw(defineAsyncComponent(s.component)),
    })),
  ),
]

const refs = ref<Record<string, { refresh?: () => void } | null>>({})
</script>

<template>
  <div class="page stack">
    <p class="small muted" style="padding: 0 4px">
      Everything the app stores or uses on this device. Deleting here is immediate and cannot be undone.
    </p>
    <DebugPanel
      v-for="s in sections"
      :key="s.id"
      :title="s.title"
      :subtitle="s.subtitle"
      @refresh="refs[s.id]?.refresh?.()"
    >
      <component :is="s.component" :ref="(el: unknown) => (refs[s.id] = el as { refresh?: () => void } | null)" />
    </DebugPanel>
  </div>
</template>
