import { History, LayoutGrid } from 'lucide-vue-next'
import type { SubApp } from '../types'
import DiaperIcon from './components/DiaperIcon.vue'
import DiaperTile from './components/DiaperTile.vue'
import { DIAPER_ACCENT } from './logic/types'

export const diaperApp: SubApp = {
  id: 'diaper',
  name: 'Diapers',
  tagline: 'Wet and dirty diapers',
  icon: DiaperIcon,
  accent: DIAPER_ACCENT,
  tile: DiaperTile,
  routes: [
    { path: '', component: () => import('./views/DiaperView.vue'), meta: { title: 'Diapers' } },
    { path: 'history', component: () => import('./views/DiaperHistoryView.vue'), meta: { title: 'Diaper history' } },
  ],
  tabs: [
    { to: '/app/diaper', label: 'Overview', icon: LayoutGrid, exact: true },
    { to: '/app/diaper/history', label: 'History', icon: History },
  ],
  debugSections: [{ id: 'diaper', title: 'Diaper log internals', component: () => import('./DiaperDebugSection.vue') }],
}
