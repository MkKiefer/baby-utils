# Baby Utils

A private, device-local baby helper built as an installable PWA (Vue 3 + Vite).
It works like an "app of apps": a home screen with the baby's age and tiles for sub-apps.
No backend, no account, no API — all data lives in IndexedDB on the device.

**Sub-apps**

- **Feed timer** – interval by age, manual override on a dial, jaundice mode, rhythm
  learning ("3h +20m"), reminders with a "Fed now" notification action, reminders pause
  after unanswered cycles, history with a 7-day rhythm chart, night mode (wake lock + chime).
- **Debug** – inspects everything the app uses on the device: IndexedDB, local/session
  storage, Cache Storage, service worker, notification plan & log, permissions, storage
  persistence, periodic sync, wake lock, audio, BroadcastChannel.

## Scripts

```bash
npm install
npm run dev        # dev server (service worker enabled in dev)
npm run build      # type-check + production build (dist/)
npm run preview    # serve dist/ on localhost
npm test           # unit tests (age, intervals, rhythm, schedule, notification engine)
```

The app shows an install screen unless it runs as an installed PWA. On `localhost` (and in
dev builds) a "Continue in the browser (developer)" link skips it for the session.

## Deploying with Docker

The `Dockerfile` builds locally in two stages: Node 24 runs the tests, the type-check and the
Vite build, and the static result is served by unprivileged nginx (non-root, read-only
filesystem) on port 8080.

```bash
cp .env.example .env               # optional: WEB_PORT, DOMAIN
docker compose up -d --build       # → http://localhost:8080
```

**Phones need HTTPS.** Service workers, installation and notifications only work in a secure
context; `localhost` is the only exception. Pick one:

- **Built-in HTTPS:** set `DOMAIN` in `.env` to a hostname whose DNS points at this server
  (ports 80 and 443 reachable) and run `docker compose --profile https up -d --build`. Caddy
  obtains and renews a Let's Encrypt certificate and adds HSTS. Set
  `WEB_PORT=127.0.0.1:8080` so the plain-HTTP port is not exposed.
- **Your own reverse proxy** (Traefik, nginx, Caddy, …): terminate TLS there and proxy to the
  `web` container on port 8080.

`deploy/nginx.conf` takes care of what a PWA needs from the server:

- `index.html`, `sw.js`, the manifest and icons are sent `no-cache`, so a new deploy is picked
  up (the in-app "Update available" banner); hashed `/assets/*` are cached for a year.
- Deep links (`/app/feed/history`) get the SPA shell; missing chunks return 404.
- `application/manifest+json`, gzip, a strict Content-Security-Policy and security headers.
- `/healthz` for the container health check.

To update: `git pull && docker compose up -d --build`. The container is stateless — all data
lives on the devices, so there is nothing to back up on the server (Caddy keeps its
certificates in the `caddy-data` volume).

## How it's built

```
src/
  core/            shell services (DOM-free parts are shared with the service worker)
    db.ts, schema.ts       one IndexedDB database; stores declared in STORES
    notify/engine.ts       evaluates providers, decides, dedupes via notifLog (page + SW)
    notify/scheduler.ts    page timer aimed at the next reminder
    sync.ts                BroadcastChannel change events (page ↔ SW ↔ tabs)
    age.ts, time.ts, platform.ts, pwa.ts, backup.ts, wakeLock.ts, chime.ts, storage.ts
  apps/
    registry.ts            UI manifests of all sub-apps (home tiles, routes, tabs)
    providers.ts           SW-safe notification providers of all sub-apps
    feed/                  logic/ (pure + IndexedDB repo), views/, components/, store.ts
    debug/                 inspectors for every browser feature in use
  views/                   install gate, onboarding, home, settings, sub-app frame
  sw.ts                    precache, offline SPA, notification actions, periodic sync
```

### Adding a sub-app

1. Create `src/apps/<id>/` with a `manifest.ts` (`SubApp`: name, icon, accent, routes, tabs,
   optional home `tile` and `debugSections`).
2. Add it to `src/apps/registry.ts`.
3. New IndexedDB stores: extend `BabyDB` + `STORES` in `src/core/schema.ts` and bump `DB_VERSION`.
4. Reminders: implement a `NotificationProvider` in a DOM/Vue-free module and add it to
   `src/apps/providers.ts`.
5. Any new browser feature or storage **must get an inspector in the Debug app**.

### Notifications without a server

Browsers cannot schedule a notification for later while an app is closed unless a push
server sends it. Since this app has no server, reminders are fired by the running app (page
timer, plus best-effort Periodic Background Sync in Chromium). Phones may suspend background
apps, so night mode keeps the screen on and chimes at reminder times. Stale reminders are
skipped instead of arriving late in a burst.

Not medical advice — the default intervals are rough guidance; use manual mode for what your
midwife or paediatrician recommends.
