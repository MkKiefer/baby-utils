/**
 * Client for the sync relay (server/http.ts). Everything sent is either a derived value or
 * ciphertext from `crypto.ts`. The group's relay token goes in the Authorization header,
 * never in a URL. Same origin by default, so the CSP needs no exception.
 */

export const SYNC_API: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SYNC_API || '/api/sync/v2'

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

export function relayClient(base = SYNC_API, doFetch: typeof fetch = (...a) => fetch(...a)): RelayClient {
  async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await doFetch(base + path, {
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
