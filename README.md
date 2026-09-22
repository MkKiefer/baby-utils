# Baby Utils

A private, device-local baby helper built as an installable PWA (Vue 3 + Vite).
It works like an "app of apps": a home screen with the baby's age and tiles for sub-apps.
All data lives in IndexedDB on the device; there is no account. An **optional**, end-to-end
encrypted sync between phones goes through a tiny relay API (`server/`) that can never read
what it forwards — see [Sync between phones](#sync-between-phones).

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
npm run dev        # dev server (service worker enabled in dev); proxies /api/sync → :8787
npm run api        # sync relay on :8787 (second terminal; only needed to try sync)
npm run build      # type-check + production build (dist/)
npm run preview    # serve dist/ on localhost
npm test           # unit tests of app and api (incl. phones syncing through a real relay)
```

The repo holds two projects: the PWA at the root (**app**) and the sync relay in `server/`
(**api**, dependency-free Node 24 that runs its TypeScript directly). Open
`baby-utils.code-workspace` in VS Code (File → Open Workspace from File…) to get both as
separate roots, with tasks `app + api: dev`, `test (app + api)`, `typecheck (app + api)` and a
debug config for the relay.

The app shows an install screen unless it runs as an installed PWA. On `localhost` (and in
dev builds) a "Continue in the browser (developer)" link skips it for the session.

## Deploying with Docker

The `Dockerfile` builds locally in two stages: Node 24 runs the tests, the type-check and the
Vite build, and the static result is served by unprivileged nginx (non-root, read-only
filesystem) on port 8080.

```bash
cp .env.example .env               # set DOMAIN
docker compose up -d --build       # → https://baby-utils.$DOMAIN
```

Compose runs two containers from the same `Dockerfile`: `web` (the PWA, default target) and
`api` (target `api`, the sync relay, state in the `api-data` volume). Neither publishes ports.
Both join the external `proxy` Docker network and are routed by an existing Traefik instance
via labels (`websecure` entrypoint): `Host(baby-utils.$DOMAIN) && PathPrefix(/api/sync)` goes
to `api`, everything else on the host to `web`. Traefik also terminates TLS. The network must exist (`docker network create proxy`) and
Traefik must be attached to it. Phones need HTTPS: service workers, installation and
notifications only work in a secure context (`localhost` is the only exception).

`deploy/nginx.conf` takes care of what a PWA needs from the server:

- `index.html`, `sw.js`, the manifest and icons are sent `no-cache`, so a new deploy is picked
  up (the in-app "Update available" banner); hashed `/assets/*` are cached for a year.
- Deep links (`/app/feed/history`) get the SPA shell; missing chunks return 404.
- `application/manifest+json`, gzip, a strict Content-Security-Policy and security headers.
- `/healthz` for the container health check.

To update: `git pull && docker compose up -d --build`. `web` is stateless. `api` only holds
ciphertext that is still waiting for a phone; losing its volume costs nothing but a resync (a
phone the relay forgot rejoins and receives the full log again), so there is nothing to back up.

## How it's built

```
src/
  core/            shell services (DOM-free parts are shared with the service worker)
    db.ts, schema.ts       one IndexedDB database; stores declared in STORES
    notify/engine.ts       evaluates providers, decides, dedupes via notifLog (page + SW)
    notify/scheduler.ts    page timer aimed at the next reminder
    sync.ts                BroadcastChannel change events (page ↔ SW ↔ tabs)
    cloud/                 optional relay sync: crypto.ts (E2E), api.ts, engine.ts (one
                           round, testable), service.ts (storage, scheduling, UI state)
    merge.ts               union-by-id feed merge (backup files and relay sync)
    age.ts, time.ts, platform.ts, pwa.ts, backup.ts, wakeLock.ts, chime.ts, storage.ts
  apps/
    registry.ts            UI manifests of all sub-apps (home tiles, routes, tabs)
    providers.ts           SW-safe notification providers of all sub-apps
    feed/                  logic/ (pure + IndexedDB repo), views/, components/, store.ts
    debug/                 inspectors for every browser feature in use
  views/                   install gate, onboarding, home, settings, sub-app frame
  sw.ts                    precache, offline SPA, notification actions, periodic sync
server/                    sync relay (api): store.ts (groups, buffer), http.ts, persist.ts, main.ts
```

### Sync between phones

Off by default; Settings → Sync between phones. One phone starts a group, the other joins by
scanning its QR code (or pasting the code). From then on feeds sync automatically while the app
is open (every 30 s, on opening, and right after an edit).

- **The group is a secret**: 256 random bits, generated on the phone. With HKDF-SHA256 each
  phone derives from it a *group id* (the relay's mailbox address — all the server ever sees)
  and an *AES-256-GCM key*. HKDF is one-way, so the id reveals nothing about the key.
- **Only the phones can read or write**: every message is encrypted and authenticated on the
  phone; the group id and the sender's member id are bound in as additional data. The relay
  cannot read, alter or re-attribute a message, and anything not sealed with the group key
  (a forged or tampered message) is rejected and dropped by the phones.
- **The relay buffers until everyone has it**: a message is kept until every member it was
  addressed to has fetched and acknowledged it, then deleted. A phone that has not checked in
  for 30 days is dropped from the group (and rejoins by itself, receiving the full log).
  Limits: 10 phones per group, ~1 MB per message, ~12 MB buffered per group.
- **What is synced**: the feed log, merged like a backup file (union by id, newer `updatedAt`
  wins, deletions as tombstones). Settings and the profile stay on each phone. Device names are
  sent inside the encrypted messages.
- **Pause or leave**: the switch pauses sync; *Leave* tells the relay to stop holding messages
  for the phone. To remove a phone, leave on all phones and start a new group — the old secret
  is then useless. The secret and sync state live in localStorage (`sync.*`), outside backups.

The relay API (`server/http.ts`), under `/api/sync/v1`:

| Method | Path | |
| --- | --- | --- |
| `POST` | `/groups/:group/members/:member` | join / heartbeat → `{ created, members }` |
| `DELETE` | `/groups/:group/members/:member` | leave |
| `GET` | `/groups/:group/messages?member=` | messages still owed to this member |
| `POST` | `/groups/:group/messages` | `{ from, to?, body }` — `body` is ciphertext |
| `POST` | `/groups/:group/ack` | `{ member, ids }` — delivered; deleted once all have it |
| `GET` | `/health` | counts only |

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
server sends it. Since the app has no push server, reminders are fired by the running app (page
timer, plus best-effort Periodic Background Sync in Chromium). Phones may suspend background
apps, so night mode keeps the screen on and chimes at reminder times. Stale reminders are
skipped instead of arriving late in a burst.

Not medical advice — the default intervals are rough guidance; use manual mode for what your
midwife or paediatrician recommends.
