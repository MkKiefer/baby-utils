import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from './views/HomeView.vue'
import SubAppLayout from './views/SubAppLayout.vue'
import { subApps } from './apps/registry'
import { useProfileStore } from './stores/profile'

const routes: RouteRecordRaw[] = [
  { path: '/', component: HomeView, meta: { title: 'Home' } },
  { path: '/setup', component: () => import('./views/OnboardingView.vue'), meta: { title: 'Welcome' } },
  { path: '/settings', component: () => import('./views/SettingsView.vue'), meta: { title: 'Settings' } },
  { path: '/sync', component: () => import('./views/SyncView.vue'), meta: { title: 'Sync' } },
  // Each sub-app lives under /app/<id>; child meta is merged with the parent's `appId`.
  ...subApps.map<RouteRecordRaw>((app) => ({
    path: `/app/${app.id}`,
    component: SubAppLayout,
    meta: { appId: app.id },
    children: app.routes,
  })),
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})

router.beforeEach(async (to) => {
  const profile = useProfileStore()
  if (!profile.loaded) await profile.load()
  if (!profile.profile && to.path !== '/setup') return '/setup'
  if (profile.profile && to.path === '/setup') return '/'
})
