<script setup lang="ts">
import { dismissToast, toasts } from '@/composables/useToast'

function run(id: number, action: () => void) {
  action()
  dismissToast(id)
}
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tone">
        <span>{{ t.message }}</span>
        <button v-if="t.action" class="action" @click="run(t.id, t.action.run)">{{ t.action.label }}</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(84px + var(--safe-bottom));
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  padding: 0 16px;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 480px;
  width: 100%;
  min-height: 52px;
  padding: 8px 8px 8px 18px;
  border-radius: 18px;
  background: #2a2230;
  color: #fff;
  font-weight: 700;
  box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.45);
}

:root[data-theme='dark'] .toast {
  background: #efe8f5;
  color: #1c1624;
}

.toast span {
  flex: 1;
}

.action {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 12px;
  font-weight: 900;
  color: var(--accent);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s var(--ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.96);
}
</style>
