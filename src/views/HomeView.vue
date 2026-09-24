<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Lock, PartyPopper, Settings, Sparkles } from 'lucide-vue-next'
import { subApps } from '@/apps/registry'
import { useProfileStore } from '@/stores/profile'
import { useNow } from '@/composables/useNow'
import { formatDate } from '@/core/time'
import { parseLocalDate } from '@/core/age'

const profile = useProfileStore()
const now = useNow()

const greeting = computed(() => {
  const h = new Date(now.value).getHours()
  if (h < 5 || h >= 23) return 'Night shift'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
})

const born = computed(() => (profile.profile ? formatDate(parseLocalDate(profile.profile.birthDate)) : ''))
const mainApps = computed(() => subApps.filter((a) => !a.utility))
const utilityApps = computed(() => subApps.filter((a) => a.utility))
</script>

<template>
  <div class="home page">
    <header class="top">
      <span class="greeting">{{ greeting }}</span>
      <RouterLink to="/settings" class="icon-btn" aria-label="Settings"><Settings :size="22" /></RouterLink>
    </header>

    <section v-if="profile.age" class="hero">
      <div class="blob b1" />
      <div class="blob b2" />
      <p class="name">{{ profile.displayName }} is</p>
      <h1 class="age">{{ profile.age.primary }}</h1>
      <p class="since num">{{ profile.age.days }} {{ profile.age.days === 1 ? 'day' : 'days' }} old · born {{ born }}</p>
      <div v-if="profile.milestone" class="milestone">
        <template v-if="profile.milestone.inDays === 0">
          <PartyPopper :size="16" />
          <span><b>{{ profile.milestone.label }}</b> today!</span>
        </template>
        <template v-else>
          <Sparkles :size="16" />
          <span>
            {{ profile.milestone.label }} in <b class="num">{{ profile.milestone.inDays }}</b>
            {{ profile.milestone.inDays === 1 ? 'day' : 'days' }}
          </span>
        </template>
      </div>
    </section>

    <h2 class="section-title">Apps</h2>
    <div class="grid">
      <RouterLink
        v-for="app in mainApps"
        :key="app.id"
        :to="`/app/${app.id}`"
        class="tile"
        :class="{ wide: !!app.tile }"
        :style="{ '--accent': app.accent }"
      >
        <span class="icon"><component :is="app.icon" :size="26" :stroke-width="2.2" /></span>
        <span class="text">
          <strong>{{ app.name }}</strong>
          <component :is="app.tile" v-if="app.tile" />
          <span v-else class="small muted">{{ app.tagline }}</span>
        </span>
        <ChevronRight :size="20" class="chev" />
      </RouterLink>
      <div class="tile placeholder">
        <span class="icon"><Sparkles :size="22" /></span>
        <span class="text">
          <strong>More soon</strong>
          <span class="small muted">Sleep…</span>
        </span>
      </div>
    </div>

    <div class="utility">
      <RouterLink
        v-for="app in utilityApps"
        :key="app.id"
        :to="`/app/${app.id}`"
        class="utility-link"
        :style="{ '--accent': app.accent }"
      >
        <component :is="app.icon" :size="16" /> {{ app.name }}
      </RouterLink>
    </div>

    <p class="private tiny faint"><Lock :size="12" /> Private by design — all data stays on this device.</p>
  </div>
</template>

<style scoped>
.home {
  padding-top: calc(12px + var(--safe-top));
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 8px;
}

.greeting {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-2);
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 26px 22px 22px;
  border-radius: var(--radius-lg);
  background: linear-gradient(145deg, #ffd9c9 0%, #ffe9dc 45%, #e9e2ff 100%);
  color: #3a2432;
  box-shadow: var(--shadow);
}

:root[data-theme='dark'] .hero {
  background: linear-gradient(145deg, #3b2130 0%, #2b1f36 55%, #1f2140 100%);
  color: #f6e9f0;
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(2px);
  opacity: 0.55;
}

.b1 {
  width: 180px;
  height: 180px;
  right: -60px;
  top: -70px;
  background: radial-gradient(circle, #ffb39c, transparent 70%);
}

.b2 {
  width: 140px;
  height: 140px;
  right: 30px;
  bottom: -80px;
  background: radial-gradient(circle, #c9bbff, transparent 70%);
}

.name {
  position: relative;
  font-size: 17px;
  font-weight: 800;
  opacity: 0.75;
}

.age {
  position: relative;
  font-size: clamp(34px, 10vw, 46px);
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: -0.03em;
  margin: 2px 0 6px;
}

.since {
  position: relative;
  font-size: 14px;
  font-weight: 700;
  opacity: 0.7;
}

.milestone {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  font-size: 14px;
  font-weight: 700;
}

:root[data-theme='dark'] .milestone {
  background: rgba(255, 255, 255, 0.1);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  min-height: 132px;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  text-decoration: none;
  transition: transform 0.18s var(--ease);
}

.tile:active {
  transform: scale(0.97);
}

.tile.wide {
  grid-column: span 2;
  flex-direction: row;
  align-items: center;
  min-height: 96px;
}

.icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 17px;
  background: color-mix(in oklab, var(--accent) 16%, transparent);
  color: var(--accent);
}

.text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.text strong {
  font-size: 17px;
  font-weight: 850;
}

.chev {
  color: var(--text-3);
}

.tile:not(.wide) .chev {
  position: absolute;
  top: 16px;
  right: 14px;
}

.placeholder {
  background: transparent;
  box-shadow: none;
  border: 2px dashed var(--line-2);
  --accent: var(--text-3);
}

.utility {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 22px;
}

.utility-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
}

.private {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
}
</style>
