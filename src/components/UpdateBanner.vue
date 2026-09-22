<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { applyUpdate, swState } from '@/core/pwa'
</script>

<template>
  <Transition name="fade">
    <div v-if="swState.needRefresh" class="update">
      <RefreshCw :size="18" />
      <span>A new version is ready.</span>
      <button class="btn sm primary" @click="applyUpdate">Update</button>
      <button class="btn sm ghost" @click="swState.needRefresh = false">Later</button>
    </div>
  </Transition>
</template>

<style scoped>
.update {
  position: fixed;
  left: 50%;
  top: calc(10px + var(--safe-top));
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(calc(100% - 24px), 480px);
  padding: 8px 8px 8px 14px;
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow);
  font-weight: 700;
  font-size: 14px;
}

.update span {
  flex: 1;
}
</style>
