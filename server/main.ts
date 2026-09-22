import { createServer } from 'node:http'
import { createHandler } from './http.ts'
import { loadState, persist } from './persist.ts'
import { SyncStore } from './store.ts'

/**
 * Baby Utils sync relay: buffers and distributes end-to-end encrypted messages between
 * the devices of a group. Run with `node server/main.ts` (Node 24 strips the types).
 *
 *   PORT      listen port (default 8787)
 *   DATA_DIR  where state.json lives (default ./data)
 */
const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.DATA_DIR ?? './data'

const store = new SyncStore(loadState(dataDir))
const { flush } = persist(store, dataDir)
store.prune()
setInterval(() => store.prune(), 3600_000).unref()

const server = createServer(createHandler(store))
server.requestTimeout = 30_000
server.listen(port, () => console.log(`sync relay listening on :${port}`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flush()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
