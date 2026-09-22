<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppBar from '@/components/AppBar.vue'
import TabBar from '@/components/TabBar.vue'
import { findApp } from '@/apps/registry'
import { useProfileStore } from '@/stores/profile'

/** Frame for every sub-app: its own accent colour, app bar with back-to-home, and tabs. */
const route = useRoute()
const profile = useProfileStore()
const app = computed(() => findApp(route.meta.appId ?? '')!)
const fullscreen = computed(() => !!route.meta.fullscreen)
const subtitle = computed(() => (profile.age ? `${profile.displayName} · ${profile.age.primary}` : undefined))
</script>

<template>
  <div class="subapp" :style="{ '--accent': app.accent }">
    <AppBar v-if="!fullscreen" :title="route.meta.title ?? app.name" :subtitle="subtitle" back="/">
      <div id="appbar-actions" class="row" style="gap: 2px" />
    </AppBar>
    <main>
      <RouterView />
    </main>
    <TabBar v-if="app.tabs && !fullscreen" :tabs="app.tabs" />
  </div>
</template>

<style scoped>
.subapp {
  /* Derived tints resolve where they are declared, so re-derive them from this app's accent. */
  --accent-soft: color-mix(in oklab, var(--accent) 16%, transparent);
  --accent-mid: color-mix(in oklab, var(--accent) 42%, var(--surface));
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

main {
  flex: 1;
}
</style>
