import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common'
import type { Request } from 'express'
import { GroupId, Public } from './auth.ts'
import { clientAddress, Limits } from './rate-limit.ts'
import { isMemberId, LIMITS, SyncError, SyncStore } from './store.ts'

/**
 * HTTP surface of the relay, mounted at /api/sync/v2 (Traefik routes that prefix here).
 * Every route but `/healthz` needs `X-Api-Key`; the group routes also the group's
 * `Authorization: Bearer <relay token>` (see auth.ts).
 *
 *   POST   /members/:member   join / heartbeat      → { created, members }
 *   DELETE /members/:member   leave                 → 204
 *   GET    /messages?member=  what is owed to me    → { messages, members }
 *   POST   /messages          { from, to?, body }   → { id }
 *   POST   /ack               { member, ids }       → 204
 *   GET    /health                                  → { ok, ...counts }
 *   GET    /healthz           liveness, no key      → { ok }
 *
 * Nothing here is logged: keys, tokens, group ids and member ids stay out of the output.
 */

export const PREFIX = '/api/sync/v2'
/** Request bodies: one message plus JSON overhead. */
export const MAX_REQUEST_BYTES = LIMITS.bodyChars + 64 * 1024

/**
 * Reads the JSON body itself (Nest's body parser is off): any content type is accepted, and
 * size and syntax errors answer with the relay's own error codes.
 */
async function readJson(req: Request): Promise<Record<string, unknown>> {
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

@Controller(PREFIX.slice(1))
export class SyncController {
  constructor(
    @Inject(SyncStore) private readonly store: SyncStore,
    @Inject(Limits) private readonly limits: Limits,
  ) {}

  @Public()
  @Get('healthz')
  liveness() {
    return { ok: true }
  }

  @Get('health')
  health() {
    return { ok: true, ...this.store.stats() }
  }

  @Post('members/:member')
  @HttpCode(200)
  join(@GroupId() group: string, @Param('member') member: string, @Req() req: Request) {
    member = memberParam(member)
    if (!this.store.hasGroup(group) && !this.limits.creations.take(clientAddress(req))) {
      throw new SyncError(429, 'rate_limited')
    }
    return this.store.join(group, member)
  }

  @Delete('members/:member')
  @HttpCode(204)
  leave(@GroupId() group: string, @Param('member') member: string): void {
    this.store.leave(group, memberParam(member))
  }

  @Get('messages')
  fetch(@GroupId() group: string, @Query('member') member: unknown) {
    return this.store.fetch(group, memberParam(member))
  }

  @Post('messages')
  @HttpCode(201)
  async post(@GroupId() group: string, @Req() req: Request) {
    const body = await readJson(req)
    const to = body.to
    if (to !== undefined && (!Array.isArray(to) || to.length > LIMITS.membersPerGroup || !to.every(isMemberId))) {
      throw new SyncError(400, 'bad_to')
    }
    return { id: this.store.post(group, memberParam(body.from), body.body as string, to as string[] | undefined) }
  }

  @Post('ack')
  @HttpCode(204)
  async ack(@GroupId() group: string, @Req() req: Request): Promise<void> {
    const body = await readJson(req)
    const ids = body.ids
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every((i) => typeof i === 'string')) {
      throw new SyncError(400, 'bad_ids')
    }
    this.store.ack(group, memberParam(body.member), ids as string[])
  }
}
