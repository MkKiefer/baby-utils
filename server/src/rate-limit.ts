import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import { RELAY_OPTIONS, type RelayOptions } from './options.ts'
import { SyncError } from './store.ts'

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

/**
 * The client address. Behind Traefik the last X-Forwarded-For hop is the one Traefik added
 * (it does not trust forwarded headers from the internet by default).
 */
export function clientAddress(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  const last = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').at(-1)?.trim()
  return last || req.socket.remoteAddress || 'unknown'
}

@Injectable()
export class Limits {
  readonly requests: RateLimiter
  readonly creations: RateLimiter

  constructor(@Inject(RELAY_OPTIONS) options: RelayOptions) {
    this.requests = new RateLimiter(options.requestsPerMinute ?? 300, 60_000, options.now)
    this.creations = new RateLimiter(options.groupsPerHour ?? 20, 3600_000, options.now)
  }
}

/** Runs before the API key check, so guessing keys is throttled as well. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(Limits) private readonly limits: Limits) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.limits.requests.take(clientAddress(context.switchToHttp().getRequest<Request>()))) {
      throw new SyncError(429, 'rate_limited')
    }
    return true
  }
}
