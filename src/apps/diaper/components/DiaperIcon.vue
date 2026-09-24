<script setup lang="ts">
/** Lucide has no diaper, so this one is drawn in its style (24 grid, round caps, currentColor). */
withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string }>(), { size: 24, strokeWidth: 2 })
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18v3a9 9 0 0 1-18 0Z" />
    <path d="M3 9h3a6 6 0 0 1 6 6v3" />
    <path d="M21 9h-3a6 6 0 0 0-6 6" />
  </svg>
</template>
