import { existsSync } from 'node:fs'
import { createApp } from './app.ts'
import { MIN_API_KEY_LENGTH } from './options.ts'
import { loadState, persist } from './persist.ts'
import { SyncStore } from './store.ts'

/**
 * Baby Utils sync relay (NestJS): buffers and distributes end-to-end encrypted messages
 * between the devices of a group.
 *
 *   API_KEY       required; the server secret the app must send as X-Api-Key
 *   PORT          listen port (default 8787)
 *   DATA_DIR      where state.json lives (default ./data)
 *   CORS_ORIGINS  optional comma-separated list of allowed browser origins (default: any)
 *
 * Outside Docker, `.env` in server/ or the repo root fills in whatever the environment lacks.
 */
for (const file of ['.env', '../.env']) if (existsSync(file)) process.loadEnvFile(file)
const apiKey = process.env.API_KEY?.trim() ?? ''
if (apiKey.length < MIN_API_KEY_LENGTH || apiKey.startsWith('change-me')) {
  console.error(`API_KEY is missing, the example value or shorter than ${MIN_API_KEY_LENGTH} characters — set it in .env.`)
  process.exit(1)
}
const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.DATA_DIR ?? './data'
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean)

const store = new SyncStore(loadState(dataDir))
const { flush } = persist(store, dataDir)
store.prune()
setInterval(() => store.prune(), 3600_000).unref()

const app = await createApp({ apiKey, corsOrigins: corsOrigins?.length ? corsOrigins : true }, store, ['error', 'warn'])
const server = app.getHttpServer() as import('node:http').Server
server.requestTimeout = 30_000
await app.listen(port)
console.log(`sync relay listening on :${port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flush()
    void app.close().finally(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
