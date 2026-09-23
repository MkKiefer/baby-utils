<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InstallGate from './views/InstallGate.vue'
import ToastHost from './components/ToastHost.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import PullToRefresh from './components/PullToRefresh.vue'
import { installBypassed, isStandalone } from './core/platform'

const installed = ref(isStandalone() || installBypassed())
matchMedia('(display-mode: standalone)').addEventListener('change', () => {
  installed.value = isStandalone() || installBypassed()
})

// "App opening" animation when going deeper (home → sub-app), reverse when going back.
const route = useRoute()
const router = useRouter()
const transition = ref('fade')
const depth = (path: string) => (path === '/' || path === '/setup' ? 0 : 1)
router.afterEach((to, from) => {
  const d = depth(to.path) - depth(from.path)
  transition.value = d > 0 ? 'app-open' : d < 0 ? 'app-close' : 'fade'
})
</script>

<template>
  <InstallGate v-if="!installed" @bypass="installed = true" />
  <template v-else>
    <RouterView v-slot="{ Component }">
      <Transition :name="transition" mode="out-in">
        <component :is="Component" :key="route.matched[0]?.path ?? route.path" />
      </Transition>
    </RouterView>
    <PullToRefresh />
    <UpdateBanner />
    <ToastHost />
  </template>
</template>
