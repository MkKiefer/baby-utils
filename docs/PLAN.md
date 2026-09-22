# Baby Utils — Plan (v1, implemented)

A device-local Vue 3 PWA that works like an "app of apps": a launcher home screen
showing the baby's age plus tiles for sub-apps. No backend and no push server; the only
server part is the optional end-to-end encrypted sync relay (`server/`, see README).

## 1. Stack

| Concern        | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Build          | Vite + `@vitejs/plugin-vue`, TypeScript                                |
| UI             | Vue 3 (`<script setup>`), Vue Router, Pinia                            |
| PWA            | `vite-plugin-pwa` with **injectManifest** (own service worker `src/sw.ts`) + `@vite-pwa/assets-generator` for icons |
| Storage        | IndexedDB via `idb` (all domain data), localStorage only for UI prefs  |
| Icons / font   | `lucide-vue-next`, `@fontsource-variable/nunito` (bundled → offline)   |
| Tests          | Vitest for pure logic (age, intervals, rhythm learning, schedule)      |

## 2. App shell flow

```
start ─► Install gate ──(not standalone)──► per-platform install instructions
            │ standalone (or dev bypass on localhost)
            ▼
         Profile set? ──no──► Onboarding (birth date → notifications → done)
            │ yes
            ▼
         Home (age hero + sub-app tiles) ─► /app/<id>/…  (each sub-app owns its routes)
```

* **Install gate**: detects `display-mode: standalone` / `navigator.standalone`.
  Shows why install is needed (notifications, offline, iOS keeps separate storage for
  home-screen apps) and step-by-step instructions for iOS Safari, iOS Chrome/Edge,
  Android Chrome, Samsung Internet, Firefox Android, desktop Chrome/Edge, macOS Safari,
  desktop Firefox (unsupported → use another browser), in-app webviews. Detected platform
  is shown first; uses `beforeinstallprompt` for a one-tap install button where available.
* **Onboarding**: baby name (optional), birth date (+ optional time), notification
  permission (needs a user gesture), request persistent storage.
* **Home**: age hero with adaptive resolution
  * < 14 days → `N days`
  * < 3 months → `W weeks D days`
  * < 2 years → `M months W weeks`
  * ≥ 2 years → `Y years M months`
  * plus "N days old · born …" and the next milestone (1 month, 100 days, …).
  * Sub-app tiles with live status (feed tile shows the countdown).
* **Settings**: profile, theme (system/light/dark), notifications, storage persistence,
  backup export/import (JSON), reset.

## 3. Sub-app architecture ("app in an app")

Each sub-app lives in `src/apps/<id>/` and exports:

* `manifest.ts` (Vue side): id, name, icon, accent colour, routes, optional home tile
  widget, optional debug sections.
* `schema.ts` (no Vue): IndexedDB object stores it needs.
* `logic/*` (no Vue): pure functions + repository code, shared with the service worker.
* optional notification **provider**: `plan(ctx) → PlannedNotification[]`, a pure function
  over IndexedDB data, so both the page and the service worker can evaluate it.

Adding a sub-app = new folder + register it in `src/apps/registry.ts` (UI) and
`src/apps/providers.ts` (SW-safe), bump `DB_VERSION` if it adds stores, and add Debug
coverage for any new browser feature it touches.

## 4. Core services (`src/core`)

* `db` — single IndexedDB database; upgrade creates any missing declared stores.
  `kv` store for settings/profile.
* `sync` — BroadcastChannel `baby-utils` so page ↔ service worker ↔ other tabs reload
  when data changes.
* `notify` — permission handling, **local scheduler**:
  collects planned notifications from all providers, keeps one timer to the next one
  (re-checked at least every 30 s and on visibility/focus), shows them through
  `registration.showNotification` (actions, tags, vibration), and records every
  shown/skipped notification in a `notifLog` store (dedupes page vs. SW).
* `badge` — `navigator.setAppBadge` when a feed is due.
* `wakeLock` — Screen Wake Lock for night mode.
* `persist` — `navigator.storage.persist()` / `estimate()`.
* `platform` — standalone detection, OS/browser detection for install help.

### Honest limitation: notifications without a server
The web platform has no API to schedule a notification for "later" while the app is
closed unless a push server sends it (Notification Triggers never shipped). Because a
server is ruled out, reminders fire **while the app is alive** (foreground or not yet
suspended in background). Mitigations:
1. **Night mode**: keeps the screen on (Wake Lock), dimmed red/amber UI, big countdown,
   in-app chime + vibration when due — reliable on every platform.
2. Periodic Background Sync (Chromium, installed PWAs) as a best-effort extra check in
   the SW; app badge on due.
3. On resume, the UI immediately shows due/overdue state; stale notifications are
   skipped instead of spamming.
The app explains this in the feed settings.

## 5. Feed timer (`src/apps/feed`)

### Data
* `feeds` store: `{ id, at, kind?: 'left'|'right'|'bottle', note?, source: 'app'|'notification', plan: { baseMin, offsetMin } }`
  (`plan` snapshots the interval that applied after this feed → stable learning).
* `kv['feed.settings']`: interval mode (auto/manual + minutes), jaundice
  `{active, since}`, rhythm learning on/off, notify-at-age-interval on/off,
  max unconfirmed reminders (default 2).

### Interval by age (auto)
| Age          | Interval |
| ------------ | -------- |
| 0–13 days    | 2h 30m   |
| 2 wk – 2 mo  | 3h       |
| 2 – 4 mo     | 3h 30m   |
| 4 mo +       | 4h       |

* **Manual** override: dialled in with a circular dial (1h–5h, 5-min steps).
* **Jaundice (Gelbsucht)**: caps the base interval at 2h, and the learned rhythm may
  only shorten, never lengthen, the interval (jaundiced babies are sleepy and must be
  woken). Shows "active for N days" and suggests turning it off after 14 days.

### Rhythm learning ("120 +30 min")
* Look at the last ≤ 8 intervals from the past 7 days: `delta = actual − planned base`.
* Ignore gaps > 1.75× base (probably unlogged feed at night) and < 0.4× base
  (cluster feeding / double tap).
* Need ≥ 3 samples; take the median, round to 5 min, clamp to
  `[-min(30, 20% base), +min(60, 25% base)]` (the clamp also stops the feedback drift
  that would otherwise happen when the user always answers the later reminder).
* UI shows `2h 00m +30m`.

### Reminder schedule (after the last confirmed feed)
* Cycle *k* (k = 1..maxUnconfirmed, default 2):
  * if offset > 0: reminder at the **age/base** time ("by age it's time, baby's rhythm
    suggests +30m") and the main reminder at base + offset;
  * otherwise one reminder at base + offset.
  * An unanswered cycle is assumed to be an unlogged feed; cycle *k+1* starts from the
    expected time of cycle *k*.
* After maxUnconfirmed unanswered cycles → **silent** until the next confirmed feed.
* Notification has a **"Fed now"** action handled in the service worker (logs the feed
  directly into IndexedDB and broadcasts the change).

### UI
* **Dial** (tap to switch view):
  * *Timer view*: ring = current interval; base part solid, rhythm extension striped,
    progress fill, overdue in warm red; centre shows countdown, due time, `2h +30m`.
  * *Day view*: 24h clock with night shading, dots for every feed in the last 24h,
    current interval arc and a "now" hand.
* Big **Fed now** button (+ optional Left / Right / Bottle chip), "Fed earlier…" opens a
  dial to pick "x minutes ago". Toast with **Undo**.
* **History**: grouped by day, time, gap to previous with ± vs plan, kind, source;
  tap to edit time/kind/note or delete. 24h stats (count, average gap, longest stretch)
  and a 7-day rhythm strip.
* **Settings**: interval mode + dial, jaundice, rhythm learning (+ reset), reminder
  options, explanation of how reminders work.
* **Night mode**: full-screen dim view with wake lock, chime and vibration.

## 6. Debug sub-app (`src/apps/debug`)
Rule: *every browser feature the app uses gets an inspector here.*
* IndexedDB: databases → stores → records (JSON), counts, delete record, clear store.
* localStorage / sessionStorage: keys + values, delete.
* Cache Storage: caches, entries.
* Service worker: registration, scope, state, waiting update, "check for update".
* Notifications: permission, the **planned schedule** from every provider, notification
  log, currently displayed notifications, "send test notification".
* Storage: quota estimate, persisted state, request persistence.
* Permissions API states, periodic sync tags, badging, wake lock, display mode, platform.
* Sub-app registry overview and feed-plan internals (base, offset, samples used).

## 7. Service worker (`src/sw.ts`)
* Workbox precache of the build → fully offline.
* `notificationclick`: "Fed now" action → add feed; default → focus/open the feed app.
* `periodicsync` → evaluate providers, show due notification, update badge.
* `message: SKIP_WAITING` → in-app "Update available" banner.

## 8. Delivery order
1. Scaffold, tokens/theme, shared UI components.
2. Core services + DB + sync.
3. Install gate, onboarding, home, settings.
4. Feed logic + unit tests.
5. Feed UI (dial, history, settings, night mode).
6. Service worker (actions, periodic sync).
7. Debug sub-app.
8. Build, type-check, tests, browser smoke test with screenshots.
