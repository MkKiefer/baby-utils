import { randomBytes } from 'node:crypto'

/**
 * The sync relay's whole state: groups of devices and the encrypted messages still owed to
 * some of them. The relay never sees a key or a plaintext — a group id is derived from the
 * group secret on the devices, and message bodies are ciphertext it only stores and hands
 * out. A message is kept until every member it was addressed to has acknowledged it.
 *
 * Pure apart from the id generator: persistence lives in `persist.ts`, HTTP in `sync.controller.ts`.
 */

export interface Member {
  joinedAt: number
  seenAt: number
}

export interface Message {
  id: string
  from: string
  at: number
  /** Opaque base64url ciphertext. */
  body: string
  /** Members that have not acknowledged the message yet. */
  pending: string[]
}

export interface Group {
  members: Record<string, Member>
  messages: Message[]
}

export interface State {
  v: 1
  groups: Record<string, Group>
}

export const LIMITS = {
  /** Base64url characters of one message body (~1.1 MB of ciphertext). */
  bodyChars: 1_500_000,
  /** Buffered body characters per group before new messages are refused. */
  groupChars: 12_000_000,
  /** Buffered body characters across all groups, so a flood cannot exhaust memory or disk. */
  totalChars: 150_000_000,
  membersPerGroup: 10,
  groups: 10_000,
  /** A member that has not polled for this long is dropped, so it stops holding messages. */
  memberTtlMs: 30 * 24 * 3600_000,
}

/** SHA-256 of the group's access token, base64url (see `groupIdFor` in auth.ts). */
const GROUP_ID = /^[A-Za-z0-9_-]{43}$/
/** 16 random bytes as base64url, chosen by the device. */
const MEMBER_ID = /^[A-Za-z0-9_-]{22}$/
const BODY = /^[A-Za-z0-9_-]+$/

export const isGroupId = (s: unknown): s is string => typeof s === 'string' && GROUP_ID.test(s)
export const isMemberId = (s: unknown): s is string => typeof s === 'string' && MEMBER_ID.test(s)

export class SyncError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

/** What a watching member is told about (see watch.ts); never any content. */
export type Nudge = 'message' | 'member'

export interface MemberInfo {
  id: string
  joinedAt: number
  seenAt: number
}

export class SyncStore {
  state: State
  /** Called after every mutation; persistence debounces it. */
  onChange: () => void = () => {}
  /** Called when members have something new to fetch; the event streams listen. */
  onNudge: (groupId: string, members: string[], nudge: Nudge) => void = () => {}

  private readonly now: () => number

  constructor(state?: State, now: () => number = Date.now) {
    this.state = state ?? { v: 1, groups: {} }
    this.now = now
  }

  private members(group: Group): MemberInfo[] {
    return Object.entries(group.members).map(([id, m]) => ({ id, ...m }))
  }

  /** Throws `member_unknown` unless the member is in the group. */
  member(groupId: string, memberId: string): Group {
    const group = this.state.groups[groupId]
    if (!group?.members[memberId]) throw new SyncError(404, 'member_unknown')
    return group
  }

  private groupChars(group: Group): number {
    return group.messages.reduce((n, m) => n + m.body.length, 0)
  }

  private totalChars(): number {
    let n = 0
    for (const g of Object.values(this.state.groups)) n += this.groupChars(g)
    return n
  }

  hasGroup(groupId: string): boolean {
    return Object.hasOwn(this.state.groups, groupId)
  }

  /**
   * Joins a group, creating it on first use. Joining again is a heartbeat.
   * `created` tells the device it was not a member before — whatever it missed is gone.
   */
  join(groupId: string, memberId: string): { created: boolean; members: MemberInfo[] } {
    const now = this.now()
    let group = this.state.groups[groupId]
    if (!group) {
      if (Object.keys(this.state.groups).length >= LIMITS.groups) throw new SyncError(503, 'server_full')
      group = this.state.groups[groupId] = { members: {}, messages: [] }
    }
    const existing = group.members[memberId]
    if (!existing && Object.keys(group.members).length >= LIMITS.membersPerGroup) {
      throw new SyncError(409, 'group_full')
    }
    group.members[memberId] = { joinedAt: existing?.joinedAt ?? now, seenAt: now }
    this.onChange()
    // The others send a newcomer the whole log, so tell them now rather than on their next poll.
    const others = Object.keys(group.members).filter((id) => id !== memberId)
    if (!existing && others.length) this.onNudge(groupId, others, 'member')
    return { created: !existing, members: this.members(group) }
  }

  leave(groupId: string, memberId: string): void {
    const group = this.state.groups[groupId]
    if (!group?.members[memberId]) return
    this.dropMember(groupId, memberId)
    this.onChange()
  }

  private dropMember(groupId: string, memberId: string) {
    const group = this.state.groups[groupId]!
    delete group.members[memberId]
    for (const m of group.messages) m.pending = m.pending.filter((p) => p !== memberId)
    group.messages = group.messages.filter((m) => m.pending.length)
    if (!Object.keys(group.members).length) delete this.state.groups[groupId]
  }

  /**
   * Buffers a message for `to` (default: every other member). Returns null when nobody
   * else is in the group — there is no one to hold it for.
   */
  post(groupId: string, from: string, body: string, to?: string[]): string | null {
    const group = this.member(groupId, from)
    if (typeof body !== 'string' || !body || !BODY.test(body)) throw new SyncError(400, 'bad_body')
    if (body.length > LIMITS.bodyChars) throw new SyncError(413, 'message_too_large')
    const others = Object.keys(group.members).filter((id) => id !== from)
    const pending = to ? others.filter((id) => to.includes(id)) : others
    if (!pending.length) return null
    if (this.groupChars(group) + body.length > LIMITS.groupChars) throw new SyncError(507, 'group_buffer_full')
    if (this.totalChars() + body.length > LIMITS.totalChars) throw new SyncError(507, 'server_buffer_full')
    const id = randomBytes(12).toString('base64url')
    const now = this.now()
    group.members[from]!.seenAt = now
    group.messages.push({ id, from, at: now, body, pending })
    this.onChange()
    this.onNudge(groupId, pending, 'message')
    return id
  }

  /** Messages still owed to `memberId`, oldest first. Also counts as a heartbeat. */
  fetch(groupId: string, memberId: string): { messages: Omit<Message, 'pending'>[]; members: MemberInfo[] } {
    const group = this.member(groupId, memberId)
    group.members[memberId]!.seenAt = this.now()
    this.onChange()
    return {
      messages: group.messages
        .filter((m) => m.pending.includes(memberId))
        .map(({ id, from, at, body }) => ({ id, from, at, body })),
      members: this.members(group),
    }
  }

  /** Marks messages as received; a message nobody is waiting for any more is deleted. */
  ack(groupId: string, memberId: string, ids: string[]): void {
    const group = this.member(groupId, memberId)
    const set = new Set(ids)
    for (const m of group.messages) {
      if (set.has(m.id)) m.pending = m.pending.filter((p) => p !== memberId)
    }
    group.messages = group.messages.filter((m) => m.pending.length)
    this.onChange()
  }

  /** Drops members that stopped polling, and with them whatever only they were owed. */
  prune(): number {
    const cutoff = this.now() - LIMITS.memberTtlMs
    let dropped = 0
    for (const [groupId, group] of Object.entries(this.state.groups)) {
      for (const [memberId, m] of Object.entries(group.members)) {
        if (m.seenAt < cutoff) {
          this.dropMember(groupId, memberId)
          dropped++
        }
      }
    }
    if (dropped) this.onChange()
    return dropped
  }

  stats() {
    const groups = Object.values(this.state.groups)
    return {
      groups: groups.length,
      members: groups.reduce((n, g) => n + Object.keys(g.members).length, 0),
      messages: groups.reduce((n, g) => n + g.messages.length, 0),
      bufferedChars: this.totalChars(),
    }
  }
}
