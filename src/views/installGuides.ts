import type { PlatformInfo } from '@/core/platform'

export interface InstallGuide {
  id: string
  title: string
  steps: string[]
  note?: string
  /** Browser cannot install: show as a warning. */
  unsupported?: boolean
  match: (p: PlatformInfo) => boolean
}

const isApple = (p: PlatformInfo) => p.os === 'ios' || p.os === 'ipados'

export const INSTALL_GUIDES: InstallGuide[] = [
  {
    id: 'inapp',
    title: 'Inside another app',
    unsupported: true,
    steps: [
      'This page is open in an in-app browser (e.g. Instagram, WhatsApp) which cannot install apps.',
      'Tap the ••• or share menu and choose “Open in browser” (Safari or Chrome).',
      'Then follow the steps for your browser.',
    ],
    match: (p) => p.browser === 'inapp',
  },
  {
    id: 'ios-safari',
    title: 'iPhone & iPad · Safari',
    steps: [
      'Tap the Share button (square with an arrow pointing up) in the toolbar.',
      'Scroll down and tap “Add to Home Screen”.',
      'Keep “Open as Web App” switched on and tap “Add”.',
      'Open Baby Utils from your home screen and set it up there.',
    ],
    note: 'Needs iOS/iPadOS 16.4 or newer for notifications. Safari and the installed app keep separate data.',
    match: (p) => isApple(p) && p.browser === 'safari',
  },
  {
    id: 'ios-other',
    title: 'iPhone & iPad · Chrome, Edge, Firefox',
    steps: [
      'Tap the Share button (in the address bar or the ••• menu).',
      'Tap “Add to Home Screen”, then “Add”.',
      'Open Baby Utils from your home screen.',
    ],
    note: 'If the option is missing, open this page in Safari and add it from there.',
    match: (p) => isApple(p) && p.browser !== 'safari',
  },
  {
    id: 'android-chrome',
    title: 'Android · Chrome',
    steps: [
      'Tap the ⋮ menu at the top right.',
      'Tap “Add to Home screen” and choose “Install” (or “Install app”).',
      'Open Baby Utils from your home screen or app drawer.',
    ],
    match: (p) => p.os === 'android' && (p.browser === 'chrome' || p.browser === 'edge' || p.browser === 'opera' || p.browser === 'other'),
  },
  {
    id: 'android-samsung',
    title: 'Android · Samsung Internet',
    steps: ['Tap the ☰ menu at the bottom right.', 'Tap “Add page to”, then “Home screen”.', 'Open Baby Utils from your home screen.'],
    match: (p) => p.os === 'android' && p.browser === 'samsung',
  },
  {
    id: 'android-firefox',
    title: 'Android · Firefox',
    steps: ['Tap the ⋮ menu.', 'Tap “Add app to Home screen” (or “Install”).', 'Open Baby Utils from your home screen.'],
    match: (p) => p.os === 'android' && p.browser === 'firefox',
  },
  {
    id: 'desktop-chromium',
    title: 'Computer · Chrome or Edge',
    steps: [
      'Click the install icon at the right end of the address bar (a screen with a small arrow).',
      'Or open the menu: Chrome → “Cast, save and share” → “Install page as app”; Edge → “Apps” → “Install this site as an app”.',
      'Start Baby Utils from its own window, the Start menu, Dock or launcher.',
    ],
    match: (p) => !p.mobile && (p.browser === 'chrome' || p.browser === 'edge' || p.browser === 'opera'),
  },
  {
    id: 'mac-safari',
    title: 'Mac · Safari 17+',
    steps: ['In the menu bar choose File → “Add to Dock…”.', 'Click “Add”.', 'Open Baby Utils from the Dock.'],
    match: (p) => p.os === 'macos' && p.browser === 'safari',
  },
  {
    id: 'desktop-firefox',
    title: 'Computer · Firefox',
    unsupported: true,
    steps: ['Firefox on computers cannot install web apps.', 'Open this page in Chrome, Edge or Safari and install it from there.'],
    match: (p) => !p.mobile && p.browser === 'firefox',
  },
]

export function guideFor(p: PlatformInfo): InstallGuide | undefined {
  return INSTALL_GUIDES.find((g) => g.match(p))
}
