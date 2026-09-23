/**
 * Client for the sync relay (server/src/sync.controller.ts). Everything sent is either a
 * derived value or ciphertext from `crypto.ts`. The server secret goes in `X-Api-Key`, the
 * group's relay token in the Authorization header — never in a URL.
 */

/** Where the relay's API lives on a sync server. */
export const SYNC_PATH = '/api/sync/v2'

/** The sync server the user chose: its address and the server secret (the API key). */
export interface RelayServer {
  /** Base address such as `https://baby-utils.example.com`; empty means this app's own address. */
  url: string
  key: string
}

/**
 * Normalises a server address typed by the user (trailing slashes and a pasted API path are
 * dropped); null when it is not an http(s) URL.
 */
export function normalizeServerUrl(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const path = url.pathname.replace(/\/+$/, '').replace(new RegExp(`${SYNC_PATH}$`), '')
  return url.origin + path
}

/** The API base for a server; an empty address means the app's own origin. */
export function relayBase(server: RelayServer): string {
  const own = typeof location === 'undefined' ? '' : location.origin
  return (normalizeServerUrl(server.url) ?? own) + SYNC_PATH
}

export interface RelayMember {
  id: string
  joinedAt: number
  seenAt: number
}

export interface RelayMessage {
  id: string
  from: string
  at: number
  body: string
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

/** Every group call takes the group's relay token (`GroupKeys.token`). */
export interface RelayClient {
  join(token: string, member: string): Promise<{ created: boolean; members: RelayMember[] }>
  leave(token: string, member: string): Promise<void>
  fetch(token: string, member: string): Promise<{ messages: RelayMessage[]; members: RelayMember[] }>
  post(token: string, from: string, body: string, to?: string[]): Promise<string | null>
  ack(token: string, member: string, ids: string[]): Promise<void>
  health(): Promise<Record<string, unknown>>
}

/** `server` is read on every call, so a changed server setting applies right away. */
export function relayClient(server: () => RelayServer, doFetch: typeof fetch = (...a) => fetch(...a)): RelayClient {
  async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
    const target = server()
    const headers: Record<string, string> = { 'X-Api-Key': target.key }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await doFetch(relayBase(target) + path, {
        method,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (e) {
      throw new RelayError(0, navigator.onLine === false ? 'offline' : `network: ${(e as Error).message}`)
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null
      throw new RelayError(res.status, err?.error ?? `http_${res.status}`)
    }
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  return {
    join: (t, m) => call('POST', `/members/${m}`, t),
    leave: (t, m) => call('DELETE', `/members/${m}`, t),
    fetch: (t, m) => call('GET', `/messages?member=${m}`, t),
    post: async (t, from, body, to) => (await call<{ id: string | null }>('POST', '/messages', t, { from, to, body })).id,
    ack: (t, member, ids) => call('POST', '/ack', t, { member, ids }),
    health: () => call('GET', '/health'),
  }
}
