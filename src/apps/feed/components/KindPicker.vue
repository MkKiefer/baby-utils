<script setup lang="ts">
import { Milk } from 'lucide-vue-next'
import type { FeedKind } from '../logic/types'

const model = defineModel<FeedKind | undefined>({ required: true })
defineProps<{ suggested?: FeedKind | null }>()

const options: { value: FeedKind; label: string; short: string }[] = [
  { value: 'left', label: 'Left', short: 'L' },
  { value: 'bottle', label: 'Bottle', short: '' },
  { value: 'right', label: 'Right', short: 'R' },
]

function pick(v: FeedKind) {
  model.value = model.value === v ? undefined : v
}
</script>

<template>
  <div class="kinds" role="radiogroup" aria-label="Feed type (optional)">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      class="kind"
      :class="{ active: model === o.value }"
      @click="pick(o.value)"
    >
      <span class="short" aria-hidden="true"><Milk v-if="o.value === 'bottle'" :size="14" :stroke-width="2.5" /><template v-else>{{ o.short }}</template></span>
      <span>{{ o.label }}</span>
      <em v-if="suggested === o.value && model !== o.value">next</em>
    </button>
  </div>
</template>

<style scoped>
.kinds {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.kind {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  border: 1.5px solid var(--line);
  font-weight: 800;
  color: var(--text-2);
  transition: all 0.2s;
}

.kind.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.short {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 12px;
  font-weight: 900;
}

.active .short {
  background: var(--accent);
  color: var(--accent-ink);
}

em {
  position: absolute;
  top: -8px;
  right: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--info);
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
}
</style>
