import { Baby, History, Settings2, Timer } from 'lucide-vue-next'
import type { SubApp } from '../types'
import FeedTile from './components/FeedTile.vue'

export const feedApp: SubApp = {
  id: 'feed',
  name: 'Feed timer',
  tagline: 'When is the next feed?',
  icon: Baby,
  accent: '#FF7A61',
  tile: FeedTile,
  routes: [
    { path: '', component: () => import('./views/FeedTimerView.vue'), meta: { title: 'Feed timer' } },
    { path: 'history', component: () => import('./views/FeedHistoryView.vue'), meta: { title: 'History' } },
    { path: 'settings', component: () => import('./views/FeedSettingsView.vue'), meta: { title: 'Feed settings' } },
    { path: 'night', component: () => import('./views/FeedNightView.vue'), meta: { title: 'Night mode', fullscreen: true } },
  ],
  tabs: [
    { to: '/app/feed', label: 'Timer', icon: Timer, exact: true },
    { to: '/app/feed/history', label: 'History', icon: History },
    { to: '/app/feed/settings', label: 'Settings', icon: Settings2 },
  ],
  debugSections: [{ id: 'feed-plan', title: 'Feed timer internals', component: () => import('./FeedDebugSection.vue') }],
}
