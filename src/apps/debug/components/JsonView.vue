<script setup lang="ts">
import { computed } from 'vue'

/** Pretty JSON; numbers that look like epoch-ms timestamps get a readable date appended. */
const props = defineProps<{ value: unknown; max?: number }>()

const isTimestamp = (n: number) => n > 1_400_000_000_000 && n < 2_500_000_000_000

const html = computed(() => {
  let text: string
  try {
    text = JSON.stringify(props.value, null, 2) ?? String(props.value)
  } catch (e) {
    text = String(e)
  }
  if (props.max && text.length > props.max) text = `${text.slice(0, props.max)}\n… (${text.length} chars)`
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi,
    (m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`
      if (lit) return `<span class="l">${lit}</span>`
      if (num) {
        const n = Number(num)
        const hint = isTimestamp(n) ? `<span class="c"> /* ${new Date(n).toLocaleString()} */</span>` : ''
        return `<span class="n">${num}</span>${hint}`
      }
      return m
    },
  )
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- content is escaped above -->
  <pre class="json" v-html="html" />
</template>

<style scoped>
.json {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  max-height: 420px;
  overflow-y: auto;
}

.json :deep(.k) {
  color: var(--info);
}

.json :deep(.s) {
  color: var(--ok);
}

.json :deep(.n) {
  color: var(--accent);
}

.json :deep(.l) {
  color: var(--night);
}

.json :deep(.c) {
  color: var(--text-3);
}
</style>
