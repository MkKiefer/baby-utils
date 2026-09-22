<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const props = defineProps<{ title: string; back?: string; subtitle?: string }>()
const router = useRouter()

function goBack() {
  if (props.back) void router.push(props.back)
  else router.back()
}
</script>

<template>
  <header class="appbar">
    <div class="inner">
      <button v-if="back !== undefined" class="icon-btn back" aria-label="Back" @click="goBack">
        <ChevronLeft :size="26" />
      </button>
      <slot name="leading" />
      <div class="titles">
        <h1>{{ title }}</h1>
        <p v-if="subtitle" class="tiny muted">{{ subtitle }}</p>
      </div>
      <div class="actions">
        <slot />
      </div>
    </div>
  </header>
</template>

<style scoped>
.appbar {
  position: sticky;
  top: 0;
  z-index: 20;
  padding-top: var(--safe-top);
  background: color-mix(in oklab, var(--bg) 82%, transparent);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
}

.inner {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: var(--page-max);
  margin: 0 auto;
  height: 56px;
  padding: 0 max(8px, var(--safe-right)) 0 max(8px, var(--safe-left));
}

.titles {
  flex: 1;
  min-width: 0;
  padding: 0 6px;
}

h1 {
  font-size: 19px;
  font-weight: 850;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
