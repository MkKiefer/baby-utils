/**
 * End-to-end encryption for relay sync. DOM/Vue free.
 *
 * A group is a 256-bit random secret that only its devices know. From it each device
 * derives, with HKDF-SHA256, two independent values:
 *
 *   - the relay token — the bearer credential for the group's mailbox on the relay, which
 *     files it under the group id SHA-256(token); the id alone grants nothing;
 *   - an AES-256-GCM key that encrypts and authenticates every message.
 *
 * HKDF is one-way, so knowing the token (the relay does) reveals nothing about the key.
 * Each message is bound to its group and sender through the GCM additional data: the relay
 * cannot read a message, alter it, or pass it off as coming from another member. Only a
 * device holding the secret can produce a message the others accept, which is how the
 * devices know they can trust each other.
 */

export interface GroupKeys {
  /** Sent to the relay as `Authorization: Bearer`; never in a URL. */
  token: string
  /** SHA-256 of the token: the relay's name for the group, and part of every message's AAD. */
  groupId: string
  key: CryptoKey
}

/** Prefix of the invite a QR code or a pasted text carries: `<prefix><secret>` (version 1). */
export const INVITE_PREFIX = 'baby-utils-sync:1:'
/** Version 2 adds the sync server: `<prefix><secret>.<base64url JSON { u, k }>`. */
export const INVITE_PREFIX_V2 = 'baby-utils-sync:2:'

const SECRET_BYTES = 32
const IV_BYTES = 12
/** Wire format byte 0; byte 1 is flags (bit 0 = deflate-raw before encryption). */
const FORMAT = 1
const FLAG_DEFLATE = 1
/** A decrypted message may inflate to at most this, so a crafted one cannot exhaust memory. */
export const MAX_PLAIN_BYTES = 32 * 1024 * 1024

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomId(bytes: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function newGroupSecret(): string {
  return randomId(SECRET_BYTES)
}

/** 16 random bytes: a device's id within one group. */
export function newMemberId(): string {
  return randomId(16)
}

export interface Invite {
  secret: string
  /** The inviting phone's sync server (address, server secret); missing from version 1. */
  server?: { url: string; key: string }
}

/**
 * The invite for a group. With a server, the joining phone also takes over its address and
 * server secret — the invite is sensitive either way, as it holds the group secret.
 */
export function inviteFor(secret: string, server?: { url: string; key: string }): string {
  if (!server) return INVITE_PREFIX + secret
  const json = new TextEncoder().encode(JSON.stringify({ u: server.url, k: server.key }))
  return `${INVITE_PREFIX_V2}${secret}.${toBase64Url(json)}`
}

const SECRET = /^[A-Za-z0-9_-]{43}$/

/** Accepts an invite (version 1 or 2) or a bare secret, whitespace ignored; null otherwise. */
export function parseInvite(text: string): Invite | null {
  const s = text.replace(/\s+/g, '')
  if (s.startsWith(INVITE_PREFIX_V2)) {
    const [secret, server] = s.slice(INVITE_PREFIX_V2.length).split('.')
    if (!secret || !SECRET.test(secret) || !server) return null
    try {
      const { u, k } = JSON.parse(new TextDecoder().decode(fromBase64Url(server))) as { u?: unknown; k?: unknown }
      if (typeof u !== 'string' || typeof k !== 'string') return null
      return { secret, server: { url: u, key: k } }
    } catch {
      return null
    }
  }
  const secret = s.startsWith(INVITE_PREFIX) ? s.slice(INVITE_PREFIX.length) : s
  return SECRET.test(secret) ? { secret } : null
}

const encoder = new TextEncoder()

export async function deriveGroup(secret: string): Promise<GroupKeys> {
  const raw = fromBase64Url(secret)
  if (raw.length !== SECRET_BYTES) throw new Error('Invalid group secret')
  const ikm = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: encoder.encode('baby-utils sync v1'),
    info: encoder.encode(info),
  })
  const token = toBase64Url(new Uint8Array(await crypto.subtle.deriveBits(params('relay token'), ikm, 256)))
  const groupId = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))))
  const key = await crypto.subtle.deriveKey(params('message key'), ikm, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return { token, groupId, key }
}

const canDeflate = typeof CompressionStream !== 'undefined'

async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_PLAIN_BYTES) {
      await reader.cancel()
      throw new Error('Message too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function aad(groupId: string, from: string) {
  return encoder.encode(`${groupId}.${from}`)
}

export async function encryptMessage(keys: GroupKeys, from: string, value: unknown): Promise<string> {
  let plain = encoder.encode(JSON.stringify(value))
  let flags = 0
  if (canDeflate) {
    plain = await transform(plain, new CompressionStream('deflate-raw'))
    flags |= FLAG_DEFLATE
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(keys.groupId, from) }, keys.key, plain),
  )
  const out = new Uint8Array(2 + IV_BYTES + cipher.length)
  out.set([FORMAT, flags])
  out.set(iv, 2)
  out.set(cipher, 2 + IV_BYTES)
  return toBase64Url(out)
}

/** Throws when the message was not made with this group's key by `from`, or was altered. */
export async function decryptMessage(keys: GroupKeys, from: string, body: string): Promise<unknown> {
  const bytes = fromBase64Url(body)
  if (bytes[0] !== FORMAT || bytes.length < 2 + IV_BYTES + 16) throw new Error('Unknown message format')
  const iv = bytes.slice(2, 2 + IV_BYTES)
  let plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(keys.groupId, from) },
      keys.key,
      bytes.slice(2 + IV_BYTES),
    ),
  )
  if (bytes[1]! & FLAG_DEFLATE) plain = await transform(plain, new DecompressionStream('deflate-raw'))
  return JSON.parse(new TextDecoder().decode(plain))
}
