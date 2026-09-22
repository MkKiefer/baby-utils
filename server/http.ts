import type { IncomingMessage, ServerResponse } from 'node:http'
import { isGroupId, isMemberId, LIMITS, SyncError, type SyncStore } from './store.ts'

/**
 * HTTP surface of the relay, mounted at /api/sync/v1 (Traefik routes that prefix here).
 *
 *   POST   /groups/:group/members/:member   join / heartbeat      → { created, members }
 *   DELETE /groups/:group/members/:member   leave                 → 204
 *   GET    /groups/:group/messages?member=  what is owed to me    → { messages, members }
 *   POST   /groups/:group/messages          { from, to?, body }   → { id }
 *   POST   /groups/:group/ack               { member, ids }       → 204
 *   GET    /health                                                → { ok, ...counts }
 *
 * Nothing here is logged: group ids and member ids stay out of the server's output.
 */

export const PREFIX = '/api/sync/v1'
/** Request bodies: one message plus JSON overhead. */
const MAX_REQUEST_BYTES = LIMITS.bodyChars + 64 * 1024

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (body === undefined) return void res.end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) throw new SyncError(413, 'request_too_large')
    chunks.push(chunk)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // fall through
  }
  throw new SyncError(400, 'bad_json')
}

function memberParam(value: unknown): string {
  if (!isMemberId(value)) throw new SyncError(400, 'bad_member')
  return value
}

export function createHandler(store: SyncStore) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://relay')
      if (!url.pathname.startsWith(PREFIX)) return send(res, 404, { error: 'not_found' })
      const parts = url.pathname.slice(PREFIX.length).split('/').filter(Boolean)
      const method = req.method ?? 'GET'

      if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
        return send(res, 200, { ok: true, ...store.stats() })
      }

      if (parts[0] !== 'groups' || !parts[1]) return send(res, 404, { error: 'not_found' })
      const group = parts[1]
      if (!isGroupId(group)) throw new SyncError(400, 'bad_group')
      const route = parts.slice(2)

      if (route[0] === 'members' && route.length === 2) {
        const member = memberParam(route[1])
        if (method === 'POST') return send(res, 200, store.join(group, member))
        if (method === 'DELETE') {
          store.leave(group, member)
          return send(res, 204)
        }
      }

      if (route[0] === 'messages' && route.length === 1) {
        if (method === 'GET') return send(res, 200, store.fetch(group, memberParam(url.searchParams.get('member'))))
        if (method === 'POST') {
          const body = await readJson(req)
          const to = body.to === undefined ? undefined : body.to
          if (to !== undefined && (!Array.isArray(to) || !to.every(isMemberId))) throw new SyncError(400, 'bad_to')
          const id = store.post(group, memberParam(body.from), body.body as string, to as string[] | undefined)
          return send(res, 201, { id })
        }
      }

      if (route[0] === 'ack' && route.length === 1 && method === 'POST') {
        const body = await readJson(req)
        const ids = body.ids
        if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((i) => typeof i === 'string')) {
          throw new SyncError(400, 'bad_ids')
        }
        store.ack(group, memberParam(body.member), ids as string[])
        return send(res, 204)
      }

      return send(res, 405, { error: 'method_not_allowed' })
    } catch (e) {
      if (e instanceof SyncError) return send(res, e.status, { error: e.code })
      console.error('relay error:', (e as Error)?.message ?? e)
      return send(res, 500, { error: 'internal' })
    }
  }
}
