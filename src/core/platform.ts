export type OS = 'ios' | 'ipados' | 'android' | 'macos' | 'windows' | 'chromeos' | 'linux' | 'other'
export type Browser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'opera' | 'inapp' | 'other'

export interface PlatformInfo {
  os: OS
  browser: Browser
  mobile: boolean
  standalone: boolean
  displayMode: string
}

export function displayMode(): string {
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
    if (matchMedia(`(display-mode: ${mode})`).matches) return mode
  }
  return 'browser'
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || ['standalone', 'fullscreen', 'minimal-ui'].includes(displayMode())
}

export function detectPlatform(ua = navigator.userAgent): PlatformInfo {
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  let os: OS = 'other'
  if (/iPhone|iPod/.test(ua)) os = 'ios'
  else if (/iPad/.test(ua) || touchMac) os = 'ipados'
  else if (/Android/.test(ua)) os = 'android'
  else if (/CrOS/.test(ua)) os = 'chromeos'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macos'
  else if (/Windows/.test(ua)) os = 'windows'
  else if (/Linux/.test(ua)) os = 'linux'

  let browser: Browser = 'other'
  if (/FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|TikTok|GSA\/|WhatsApp/.test(ua)) browser = 'inapp'
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung'
  else if (/EdgiOS|EdgA|Edg\//.test(ua)) browser = 'edge'
  else if (/OPR\/|OPiOS|Opera/.test(ua)) browser = 'opera'
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox'
  else if (/CriOS|Chrome\//.test(ua)) browser = 'chrome'
  else if (/Safari\//.test(ua)) browser = 'safari'

  return {
    os,
    browser,
    mobile: os === 'ios' || os === 'ipados' || os === 'android',
    standalone: isStandalone(),
    displayMode: displayMode(),
  }
}

/** Localhost and dev builds may skip the install gate to allow testing in a normal tab. */
export function canBypassInstall(): boolean {
  return import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(location.hostname)
}

export const BYPASS_KEY = 'bu.installBypass'

export function installBypassed(): boolean {
  try {
    return canBypassInstall() && sessionStorage.getItem(BYPASS_KEY) === '1'
  } catch {
    return false
  }
}

export function setInstallBypass(on: boolean) {
  try {
    if (on) sessionStorage.setItem(BYPASS_KEY, '1')
    else sessionStorage.removeItem(BYPASS_KEY)
  } catch {
    /* storage unavailable */
  }
}
