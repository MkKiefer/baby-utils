<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { watch } from 'vue'

const open = defineModel<boolean>({ required: true })
defineProps<{ title: string }>()

function close() {
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="close">
        <section class="sheet" role="dialog" aria-modal="true" :aria-label="title">
          <div class="grab" />
          <header>
            <h2>{{ title }}</h2>
            <button class="icon-btn" aria-label="Close" @click="close"><X :size="22" /></button>
          </header>
          <div class="body">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(15, 10, 20, 0.42);
}

.sheet {
  width: 100%;
  max-width: var(--page-max);
  max-height: 92dvh;
  overflow: auto;
  background: var(--bg);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: 6px max(16px, var(--safe-right)) calc(20px + var(--safe-bottom)) max(16px, var(--safe-left));
  box-shadow: 0 -20px 60px -20px rgba(0, 0, 0, 0.35);
}

.grab {
  width: 40px;
  height: 5px;
  border-radius: 3px;
  background: var(--line-2);
  margin: 4px auto 6px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

h2 {
  font-size: 20px;
  font-weight: 850;
  padding-left: 4px;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: background 0.25s;
}

.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.32s var(--ease);
}

.sheet-enter-from,
.sheet-leave-to {
  background: transparent;
}

.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
