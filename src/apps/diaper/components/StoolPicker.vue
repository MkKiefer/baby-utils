<script setup lang="ts">
import { STOOL_COLORS, type StoolColor } from '../logic/types'

/** Stool colour swatches; tapping the selected one clears it. */
const model = defineModel<StoolColor | undefined>({ required: true })

function pick(v: StoolColor) {
  model.value = model.value === v ? undefined : v
}
</script>

<template>
  <div class="stools" role="radiogroup" aria-label="Stool colour (optional)">
    <button
      v-for="c in STOOL_COLORS"
      :key="c.value"
      type="button"
      role="radio"
      :aria-checked="model === c.value"
      class="stool"
      :class="{ active: model === c.value, warn: c.warn }"
      @click="pick(c.value)"
    >
      <span class="swatch" :style="{ background: c.swatch }" aria-hidden="true" />
      <span class="label">{{ c.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.stools {
  display: grid;
  /* Three columns where the labels fit (the sheet), two in narrower cards. */
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 8px;
}

.stool {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 42px;
  padding: 6px 8px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--line);
  font-size: 12px;
  line-height: 1.15;
  font-weight: 800;
  color: var(--text-2);
  text-align: left;
  transition: all 0.2s;
}

.stool.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.stool.warn.active {
  border-color: var(--warn);
  background: var(--warn-soft);
}

.swatch {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
}

.label {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
