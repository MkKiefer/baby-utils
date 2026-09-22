<script setup lang="ts">
const on = defineModel<boolean>({ required: true })
defineProps<{ label: string }>()
</script>

<template>
  <button type="button" role="switch" class="switch" :class="{ on }" :aria-checked="on" :aria-label="label" @click="on = !on">
    <span class="thumb" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  flex: none;
  width: 52px;
  height: 32px;
  border-radius: 999px;
  background: var(--surface-3);
  transition: background 0.2s;
}

.switch.on {
  background: var(--accent);
}

.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  transition: transform 0.25s var(--ease);
}

.on .thumb {
  transform: translateX(20px);
}
</style>
