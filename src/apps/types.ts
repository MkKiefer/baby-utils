import type { Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

/** UI side of a sub-app. Its SW-safe parts are registered in `providers.ts`. */
export interface SubApp {
  id: string
  name: string
  tagline: string
  icon: Component
  /** Accent colour used inside the sub-app and on its tile. */
  accent: string
  /** Child routes of `/app/<id>`; the empty path is the start screen. */
  routes: RouteRecordRaw[]
  tabs?: { to: string; label: string; icon: Component; exact?: boolean }[]
  /** Live status line on the home tile. */
  tile?: Component
  /** Extra inspectors shown in the Debug app. */
  debugSections?: { id: string; title: string; component: () => Promise<Component> }[]
  /** Visually de-emphasised tile (tools like Debug). */
  utility?: boolean
}
