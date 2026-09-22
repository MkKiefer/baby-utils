import { reactive } from 'vue'

export type ThemePref = 'system' | 'light' | 'dark'

export const THEME_KEY = 'bu.theme'
const THEME_COLORS = { light: '#F7F2EC', dark: '#131019' }

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export const themeState = reactive({
  pref: readPref(),
  resolved: 'light' as 'light' | 'dark',
  /** Temporary status bar colour, e.g. black in night mode. */
  override: null as string | null,
})

const media = matchMedia('(prefers-color-scheme: dark)')

export function applyTheme() {
  const dark = themeState.pref === 'dark' || (themeState.pref === 'system' && media.matches)
  themeState.resolved = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = themeState.resolved
  const color = themeState.override ?? THEME_COLORS[themeState.resolved]
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

export function setTheme(pref: ThemePref) {
  themeState.pref = pref
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* storage unavailable */
  }
  applyTheme()
}

export function setThemeColorOverride(color: string | null) {
  themeState.override = color
  applyTheme()
}

media.addEventListener('change', applyTheme)
