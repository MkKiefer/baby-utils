/**
 * Client for the sync relay (server/http.ts). Everything sent is either a derived id or
 * ciphertext from `crypto.ts`. Same origin by default, so the CSP needs no exception.
 */

export const SYNC_API: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SYNC_API || '/api/sync/v1'

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

export interface RelayClient {
  join(group: string, member: string): Promise<{ created: boolean; members: RelayMember[] }>
  leave(group: string, member: string): Promise<void>
  fetch(group: string, member: string): Promise<{ messages: RelayMessage[]; members: RelayMember[] }>
  post(group: string, from: string, body: string, to?: string[]): Promise<string | null>
  ack(group: string, member: string, ids: string[]): Promise<void>
  health(): Promise<Record<string, unknown>>
}

export function relayClient(base = SYNC_API, doFetch: typeof fetch = (...a) => fetch(...a)): RelayClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await doFetch(base + path, {
        method,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
    join: (g, m) => call('POST', `/groups/${g}/members/${m}`),
    leave: (g, m) => call('DELETE', `/groups/${g}/members/${m}`),
    fetch: (g, m) => call('GET', `/groups/${g}/messages?member=${m}`),
    post: async (g, from, body, to) => (await call<{ id: string | null }>('POST', `/groups/${g}/messages`, { from, to, body })).id,
    ack: (g, member, ids) => call('POST', `/groups/${g}/ack`, { member, ids }),
    health: () => call('GET', '/health'),
  }
}
