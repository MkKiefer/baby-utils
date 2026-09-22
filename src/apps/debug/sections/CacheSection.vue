<script setup lang="ts">
import { onMounted, ref } from 'vue'

const caches_ = ref<{ name: string; urls: string[] }[]>([])
const open = ref<string | null>(null)
const error = ref('')

async function refresh() {
  if (typeof caches === 'undefined') {
    error.value = 'Cache Storage is not available'
    return
  }
  const names = await caches.keys()
  caches_.value = await Promise.all(
    names.map(async (name) => {
      const keys = await (await caches.open(name)).keys()
      return { name, urls: keys.map((r) => r.url.replace(location.origin, '')) }
    }),
  )
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <p v-if="error" class="tiny faint">{{ error }}</p>
  <p v-else-if="!caches_.length" class="tiny faint">No caches (the service worker precache appears after first install).</p>
  <div v-for="c in caches_" :key="c.name">
    <button class="row" style="width: 100%; min-height: 40px" @click="open = open === c.name ? null : c.name">
      <code>{{ c.name }}</code>
      <span class="spacer" />
      <span class="chip">{{ c.urls.length }}</span>
    </button>
    <ul v-if="open === c.name" class="urls">
      <li v-for="u in c.urls" :key="u">
        <code>{{ u }}</code>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.urls {
  margin: 0;
  padding: 0 0 0 16px;
  font-size: 12px;
  word-break: break-all;
}
</style>
