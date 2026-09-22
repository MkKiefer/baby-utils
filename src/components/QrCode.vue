<script setup lang="ts">
import { computed } from 'vue'
import qrcode from 'qrcode-generator'

/** A QR code as one SVG path. Always black on white with a quiet zone, even in dark mode. */
const props = defineProps<{ value: string }>()

const MARGIN = 4

const code = computed(() => {
  const qr = qrcode(0, 'L')
  qr.addData(props.value, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`
    }
  }
  return { size: n + MARGIN * 2, d }
})
</script>

<template>
  <svg class="qr" :viewBox="`0 0 ${code.size} ${code.size}`" shape-rendering="crispEdges" role="img" aria-label="Sync code">
    <rect :width="code.size" :height="code.size" fill="#fff" />
    <path :d="code.d" fill="#000" />
  </svg>
</template>

<style scoped>
.qr {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
}
</style>
