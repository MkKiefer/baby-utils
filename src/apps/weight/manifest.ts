import { History, Scale, Settings2 } from 'lucide-vue-next'
import type { SubApp } from '../types'
import WeightTile from './components/WeightTile.vue'
import { WEIGHT_ACCENT } from './logic/types'

export const weightApp: SubApp = {
  id: 'weight',
  name: 'Weight',
  tagline: 'How is baby growing?',
  icon: Scale,
  accent: WEIGHT_ACCENT,
  tile: WeightTile,
  routes: [
    { path: '', component: () => import('./views/WeightView.vue'), meta: { title: 'Weight' } },
    { path: 'history', component: () => import('./views/WeightHistoryView.vue'), meta: { title: 'Weighings' } },
    { path: 'settings', component: () => import('./views/WeightSettingsView.vue'), meta: { title: 'Weight settings' } },
  ],
  tabs: [
    { to: '/app/weight', label: 'Overview', icon: Scale, exact: true },
    { to: '/app/weight/history', label: 'History', icon: History },
    { to: '/app/weight/settings', label: 'Settings', icon: Settings2 },
  ],
  debugSections: [{ id: 'weight', title: 'Weight tracker internals', component: () => import('./WeightDebugSection.vue') }],
}
