import { History, LayoutGrid, Pill } from 'lucide-vue-next'
import type { SubApp } from '../types'
import MedsTile from './components/MedsTile.vue'
import { MEDS_ACCENT } from './logic/types'

export const medsApp: SubApp = {
  id: 'meds',
  name: 'Medication',
  tagline: 'Plans and doses given',
  icon: Pill,
  accent: MEDS_ACCENT,
  tile: MedsTile,
  routes: [
    { path: '', component: () => import('./views/MedsView.vue'), meta: { title: 'Medication' } },
    { path: 'history', component: () => import('./views/MedsHistoryView.vue'), meta: { title: 'Medication history' } },
  ],
  tabs: [
    { to: '/app/meds', label: 'Today', icon: LayoutGrid, exact: true },
    { to: '/app/meds/history', label: 'History', icon: History },
  ],
  debugSections: [{ id: 'meds', title: 'Medication internals', component: () => import('./MedsDebugSection.vue') }],
}
