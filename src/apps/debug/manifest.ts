import { Bug } from 'lucide-vue-next'
import type { SubApp } from '../types'

export const debugApp: SubApp = {
  id: 'debug',
  name: 'Debug',
  tagline: 'What is stored on this device',
  icon: Bug,
  accent: '#7B8BB2',
  utility: true,
  routes: [{ path: '', component: () => import('./views/DebugView.vue'), meta: { title: 'Debug' } }],
}
