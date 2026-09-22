import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/nunito'
import './styles/base.css'
import App from './App.vue'
import { router } from './router'
import { applyTheme } from './core/theme'
import { captureInstallPrompt, initServiceWorker } from './core/pwa'
import { startScheduler } from './core/notify/scheduler'
import { refreshStorage } from './core/storage'

captureInstallPrompt()
applyTheme()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

initServiceWorker()
startScheduler()
void refreshStorage()

// Notification taps focus an open window and ask it to navigate (see sw.ts).
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'navigate' && typeof event.data.url === 'string') void router.push(event.data.url)
})
