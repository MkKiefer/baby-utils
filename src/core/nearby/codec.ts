import type { FeedEntry, FeedKind } from '@/apps/feed/logic/types'

/**
 * Wire format for syncing two phones held next to each other: one shows a looping series
 * of QR codes, the other films them. No network, no server — the screen is the channel.
 *
 * Feeds travel as compact tuples, deflated and base64url-encoded, then cut into frames
 * that each fit a QR code a phone camera reads comfortably off another screen. Times are
 * sent as exact millisecond deltas: rounding `updatedAt` would make every later merge see
 * the other copy as "newer" and rewrite it.
 */

export interface NearbyPayload {
  v: 1
  /** When the sending phone built the payload (its clock). */
  sentAt: number
  /** Only changes after this time are included; null = the whole feed log. */
  since: number | null
  feeds: FeedEntry[]
}

const KINDS: (FeedKind | undefined)[] = [undefined, 'left', 'right', 'bottle']
const SOURCES: FeedEntry['source'][] = ['app', 'notification', 'import']

type Tuple = [
  id: string,
  at: number,
  createdMinusAt: number,
  updatedMinusCreated: number,
  kind: number,
  source: number,
  baseMin: number,
  offsetMin: number,
  note?: string | 0,
  deletedMinusUpdated?: number,
]

export function toTuple(e: FeedEntry): Tuple {
  const t: Tuple = [
    e.id,
    e.at,
    e.createdAt - e.at,
    e.updatedAt - e.createdAt,
    Math.max(0, KINDS.indexOf(e.kind)),
    Math.max(0, SOURCES.indexOf(e.source)),
    e.plan?.baseMin ?? 0,
    e.plan?.offsetMin ?? 0,
  ]
  if (e.note || e.deletedAt) t.push(e.note || 0)
  if (e.deletedAt) t.push(e.deletedAt - e.updatedAt)
  return t
}

/** Returns a loose record; `normalizeEntry` in the merge validates it like any import. */
export function fromTuple(t: unknown): unknown {
  if (!Array.isArray(t) || typeof t[0] !== 'string' || typeof t[1] !== 'number') return null
  const [id, at, dc, du, kind, source, baseMin, offsetMin, note, dd] = t as Tuple
  const createdAt = at + dc
  const updatedAt = createdAt + du
  const entry: Partial<FeedEntry> = {
    id,
    at,
    createdAt,
    updatedAt,
    source: SOURCES[source] ?? 'import',
    plan: { baseMin, offsetMin },
  }
  const k = KINDS[kind]
  if (k) entry.kind = k
  if (typeof note === 'string' && note) entry.note = note
  if (typeof dd === 'number') entry.deletedAt = updatedAt + dd
  return entry
}

// ------------------------------------------------------------------ bytes

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export const compressionSupported = typeof CompressionStream !== 'undefined'

/**
 * Serialises a payload to a URL-safe string. The first character says how: `z` deflated,
 * `j` plain (for browsers without CompressionStream — iOS before 16.4).
 */
export async function packPayload(payload: NearbyPayload, compress = compressionSupported): Promise<string> {
  const wire = { v: payload.v, s: payload.sentAt, w: payload.since, f: payload.feeds.map(toTuple) }
  const bytes = new TextEncoder().encode(JSON.stringify(wire))
  if (!compress) return 'j' + toBase64Url(bytes)
  return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))
}

export interface UnpackedPayload {
  sentAt: number
  since: number | null
  /** Loose records, still to be validated by the merge. */
  records: unknown[]
}

export async function unpackPayload(text: string): Promise<UnpackedPayload> {
  let bytes = fromBase64Url(text.slice(1))
  if (text[0] === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed sync codes.')
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
  } else if (text[0] !== 'j') {
    throw new Error('Unknown sync code format.')
  }
  const wire = JSON.parse(new TextDecoder().decode(bytes)) as { v: number; s: number; w: number | null; f: unknown[] }
  if (wire?.v !== 1 || !Array.isArray(wire.f)) throw new Error('This sync code comes from a newer app version.')
  return { sentAt: wire.s, since: wire.w ?? null, records: wire.f.map(fromTuple) }
}

// ------------------------------------------------------------------ frames

const PREFIX = 'BU1'

/**
 * Characters of payload per QR code. ~350 bytes keeps codes around version 12 at error
 * correction L — dense enough to be quick, sparse enough to read off a phone screen.
 */
export const FRAME_CHARS = 350

/** `BU1:<session>:<index>:<count>:<chunk>` — base64url never contains a colon. */
export function toFrames(data: string, session: string, size = FRAME_CHARS): string[] {
  const count = Math.max(1, Math.ceil(data.length / size))
  return Array.from({ length: count }, (_, i) => `${PREFIX}:${session}:${i}:${count}:${data.slice(i * size, (i + 1) * size)}`)
}

export function newSession(): string {
  return Math.random().toString(36).slice(2, 8)
}

export interface CollectProgress {
  received: number
  total: number
  /** Joined payload once every frame arrived. */
  data: string | null
}

/**
 * Gathers frames in any order, however often each is seen. A code from a different
 * session (the other phone restarted) starts over rather than mixing two payloads.
 */
export class FrameCollector {
  private session = ''
  private chunks: (string | undefined)[] = []
  private received = 0

  /** Returns progress for a recognised frame, or null for any other QR code. */
  add(text: string): CollectProgress | null {
    const m = /^BU1:([a-z0-9]+):(\d+):(\d+):([A-Za-z0-9_-]*)$/.exec(text)
    if (!m) return null
    const [, session, i, n, chunk] = m
    const index = Number(i)
    const total = Number(n)
    if (!total || index >= total) return null
    if (session !== this.session || total !== this.chunks.length) {
      this.session = session
      this.chunks = new Array(total)
      this.received = 0
    }
    if (this.chunks[index] === undefined) {
      this.chunks[index] = chunk
      this.received++
    }
    return {
      received: this.received,
      total,
      data: this.received === total ? this.chunks.join('') : null,
    }
  }

  reset() {
    this.session = ''
    this.chunks = []
    this.received = 0
  }
}
