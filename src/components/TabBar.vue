<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ tabs: { to: string; label: string; icon: Component; exact?: boolean }[] }>()
</script>

<template>
  <nav class="tabbar">
    <div class="inner">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        :exact-active-class="tab.exact ? 'active' : ''"
        :active-class="tab.exact ? '' : 'active'"
      >
        <component :is="tab.icon" :size="22" :stroke-width="2.2" />
        <span>{{ tab.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.tabbar {
  position: sticky;
  bottom: 0;
  z-index: 20;
  padding-bottom: var(--safe-bottom);
  background: color-mix(in oklab, var(--bg) 86%, transparent);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-top: 1px solid var(--line);
}

.inner {
  display: flex;
  max-width: var(--page-max);
  margin: 0 auto;
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0 6px;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-3);
  text-decoration: none;
  transition: color 0.2s;
}

.tab.active {
  color: var(--accent);
}
</style>
