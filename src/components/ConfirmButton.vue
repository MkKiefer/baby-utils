<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/** Two-step button for destructive actions: first tap arms, second tap confirms. */
const props = withDefaults(defineProps<{ label: string; confirmLabel?: string }>(), { confirmLabel: 'Tap again to confirm' })
const emit = defineEmits<{ confirm: [] }>()
const armed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function click() {
  if (armed.value) {
    armed.value = false
    clearTimeout(timer)
    emit('confirm')
    return
  }
  armed.value = true
  timer = setTimeout(() => (armed.value = false), 3500)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button type="button" class="btn danger" :class="{ armed }" @click="click">
    <slot />
    {{ armed ? props.confirmLabel : props.label }}
  </button>
</template>

<style scoped>
.armed {
  background: var(--warn);
  color: #fff;
}
</style>
