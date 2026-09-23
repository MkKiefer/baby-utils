import { createHash, timingSafeEqual } from 'node:crypto'
import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { RELAY_OPTIONS, type RelayOptions } from './options.ts'
import { SyncError } from './store.ts'

/**
 * Two credentials guard the relay:
 *
 * - `X-Api-Key: <server secret>` — the operator's secret from `.env`. Without it the relay
 *   answers nothing but its liveness probe, so it is not open to the whole internet.
 * - `Authorization: Bearer <relay token>` — a 256-bit value the phones derive from the group
 *   secret (independent of the message key). The relay files the group under SHA-256(token),
 *   so the id in its state file or a log is not enough to act on the group.
 *
 * Nothing secret travels in a URL, which proxies tend to log.
 */

/** 32 random bytes as base64url. */
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/

/** The relay-side group id of a token; the client computes the same value for its AAD. */
export function groupIdFor(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

const sha256 = (s: string) => createHash('sha256').update(s).digest()

/** Constant-time comparison (hashing first evens out the lengths). */
export function apiKeyMatches(given: unknown, expected: string): boolean {
  return typeof given === 'string' && timingSafeEqual(sha256(given), sha256(expected))
}

const PUBLIC = 'relay:public'
/** Marks a route that needs no API key (the container's liveness probe). */
export const Public = () => SetMetadata(PUBLIC, true)

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RELAY_OPTIONS) private readonly options: RelayOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])) return true
    const req = context.switchToHttp().getRequest<Request>()
    if (!apiKeyMatches(req.headers['x-api-key'], this.options.apiKey)) throw new SyncError(401, 'bad_api_key')
    return true
  }
}

/** The relay-side group id from the request's `Authorization: Bearer` relay token. */
export const GroupId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const req = context.switchToHttp().getRequest<Request>()
  const token = TOKEN.exec(req.headers.authorization ?? '')?.[1]
  if (!token) throw new SyncError(401, 'unauthorized')
  return groupIdFor(token)
})
