<script setup lang="ts" generic="T extends string | number">
const model = defineModel<T>({ required: true })
defineProps<{ options: { value: T; label: string }[]; label: string }>()
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      role="radio"
      :aria-checked="model === opt.value"
      :class="{ active: model === opt.value }"
      @click="model = opt.value"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-2);
}

button {
  flex: 1;
  min-height: 38px;
  padding: 0 10px;
  border-radius: 999px;
  font-weight: 800;
  font-size: 14px;
  color: var(--text-2);
  transition:
    background 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}

button.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm), 0 2px 8px -2px rgba(0, 0, 0, 0.12);
}
</style>
