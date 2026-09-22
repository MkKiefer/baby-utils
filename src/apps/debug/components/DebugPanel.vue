<script setup lang="ts">
import { ChevronDown, RefreshCw } from 'lucide-vue-next'
import { ref } from 'vue'

/** Collapsible debug section with an optional refresh action. */
const props = defineProps<{ title: string; subtitle?: string; open?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const isOpen = ref(props.open ?? false)

function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value) emit('refresh')
}
</script>

<template>
  <section class="panel" :class="{ open: isOpen }">
    <header>
      <button class="head" :aria-expanded="isOpen" @click="toggle">
        <ChevronDown :size="18" class="chev" />
        <span class="t">{{ title }}</span>
        <span v-if="subtitle" class="tiny faint sub">{{ subtitle }}</span>
      </button>
      <button v-if="isOpen" class="icon-btn" aria-label="Refresh" @click="emit('refresh')"><RefreshCw :size="16" /></button>
    </header>
    <div v-if="isOpen" class="content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--surface);
  border-radius: 18px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  padding-right: 6px;
}

.head {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 14px;
  text-align: left;
}

.t {
  font-weight: 850;
}

.sub {
  margin-left: auto;
}

.chev {
  transition: transform 0.2s;
  transform: rotate(-90deg);
  color: var(--text-3);
}

.open .chev {
  transform: none;
}

.content {
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.content :deep(td),
.content :deep(th) {
  padding: 6px 4px;
  border-top: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}

.content :deep(th) {
  color: var(--text-3);
  font-weight: 800;
  width: 38%;
}

.content :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
}
</style>
