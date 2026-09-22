/// <reference types="vite/client" />

import 'vue-router'

declare global {
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    appId?: string
    fullscreen?: boolean
  }
}
