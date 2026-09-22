import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isMemberId, LIMITS, SyncError, type SyncStore } from './store.ts'

/**
 * HTTP surface of the relay, mounted at /api/sync/v2 (Traefik routes that prefix here).
 *
 * Every group route needs `Authorization: Bearer <token>`: a 256-bit value the devices derive
 * from the group secret (independent of the message key). The relay files the group under
 * SHA-256(token), so the id that ends up in its state file, the Debug app or a log is not
 * enough to act on the group — only a holder of the token can join, read, post, ack or leave.
 * Nothing secret travels in a URL, which proxies tend to log.
 *
 *   POST   /members/:member   join / heartbeat      → { created, members }
 *   DELETE /members/:member   leave                 → 204
 *   GET    /messages?member=  what is owed to me    → { messages, members }
 *   POST   /messages          { from, to?, body }   → { id }
 *   POST   /ack               { member, ids }       → 204
 *   GET    /health                                  → { ok, ...counts }
 *
 * Nothing here is logged: tokens, group ids and member ids stay out of the server's output.
 */

export const PREFIX = '/api/sync/v2'
/** Request bodies: one message plus JSON overhead. */
const MAX_REQUEST_BYTES = LIMITS.bodyChars + 64 * 1024
/** 32 random bytes as base64url. */
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/

/** The relay-side group id of a token; the client computes the same value for its AAD. */
export function groupIdFor(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/** Fixed-window counter per key (client address). */
export class RateLimiter {
  private hits = new Map<string, number>()
  private windowStart = 0
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  take(key: string): boolean {
    const t = this.now()
    if (t - this.windowStart >= this.windowMs) {
      this.hits.clear()
      this.windowStart = t
    }
    const n = (this.hits.get(key) ?? 0) + 1
    this.hits.set(key, n)
    return n <= this.max
  }
}

export interface HandlerOptions {
  /** Requests per client per minute. A phone makes ~10 while the app is open. */
  requestsPerMinute?: number
  /** New groups per client per hour. */
  groupsPerHour?: number
  now?: () => number
}

/**
 * The client address. Behind Traefik the last X-Forwarded-For hop is the one Traefik added
 * (it does not trust forwarded headers from the internet by default).
 */
function clientAddress(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for']
  const last = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').at(-1)?.trim()
  return last || req.socket.remoteAddress || 'unknown'
}

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

function groupFromAuth(req: IncomingMessage): string {
  const token = TOKEN.exec(req.headers.authorization ?? '')?.[1]
  if (!token) throw new SyncError(401, 'unauthorized')
  return groupIdFor(token)
}

export function createHandler(store: SyncStore, options: HandlerOptions = {}) {
  const requests = new RateLimiter(options.requestsPerMinute ?? 300, 60_000, options.now)
  const creations = new RateLimiter(options.groupsPerHour ?? 20, 3600_000, options.now)

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://relay')
      if (!url.pathname.startsWith(PREFIX)) return send(res, 404, { error: 'not_found' })
      const client = clientAddress(req)
      if (!requests.take(client)) throw new SyncError(429, 'rate_limited')
      const route = url.pathname.slice(PREFIX.length).split('/').filter(Boolean)
      const method = req.method ?? 'GET'

      if (route.length === 1 && route[0] === 'health' && method === 'GET') {
        return send(res, 200, { ok: true, ...store.stats() })
      }
      if (!['members', 'messages', 'ack'].includes(route[0] ?? '')) return send(res, 404, { error: 'not_found' })

      const group = groupFromAuth(req)

      if (route[0] === 'members' && route.length === 2) {
        const member = memberParam(route[1])
        if (method === 'POST') {
          if (!store.hasGroup(group) && !creations.take(client)) throw new SyncError(429, 'rate_limited')
          return send(res, 200, store.join(group, member))
        }
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
          if (to !== undefined && (!Array.isArray(to) || to.length > LIMITS.membersPerGroup || !to.every(isMemberId))) {
            throw new SyncError(400, 'bad_to')
          }
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
      if (e instanceof SyncError) {
        if (e.status === 429) res.setHeader('Retry-After', '60')
        return send(res, e.status, { error: e.code })
      }
      console.error('relay error:', (e as Error)?.message ?? e)
      return send(res, 500, { error: 'internal' })
    }
  }
}
