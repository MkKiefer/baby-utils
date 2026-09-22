<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { applyUpdate, swState } from '@/core/pwa'

const info = ref<Record<string, unknown>>({})
const checking = ref(false)

function worker(w: ServiceWorker | null | undefined) {
  return w ? `${w.state} · ${w.scriptURL.replace(location.origin, '')}` : '—'
}

async function refresh() {
  const reg = await navigator.serviceWorker?.getRegistration()
  info.value = {
    supported: 'serviceWorker' in navigator,
    registered: !!reg,
    scope: reg?.scope ?? '—',
    active: worker(reg?.active),
    waiting: worker(reg?.waiting),
    installing: worker(reg?.installing),
    controller: worker(navigator.serviceWorker?.controller),
    updateViaCache: reg?.updateViaCache ?? '—',
    needRefresh: swState.needRefresh,
    offlineReady: swState.offlineReady,
    registerError: swState.error || '—',
    periodicSync: swState.periodicSync || '—',
  }
}

async function checkUpdate() {
  checking.value = true
  try {
    await (await navigator.serviceWorker?.getRegistration())?.update()
  } finally {
    checking.value = false
    await refresh()
  }
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <table>
    <tr v-for="(v, k) in info" :key="k">
      <th>{{ k }}</th>
      <td>
        <code>{{ v }}</code>
      </td>
    </tr>
  </table>
  <div class="row">
    <button class="btn sm" :disabled="checking" @click="checkUpdate">Check for update</button>
    <button v-if="swState.needRefresh" class="btn sm primary" @click="applyUpdate">Apply update</button>
  </div>
</template>
