import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import type { Response } from 'express'
import { SyncError, SyncStore, type Nudge } from './store.ts'

/**
 * Open event streams (`GET /events`), so a phone hears right away that something is owed
 * to it instead of waiting for its next poll. A stream carries no content — only the kind
 * of change (`message`, `member`); the phone then runs its usual round to fetch it.
 */

/** Streams per member (a phone that reconnects before the old stream timed out). */
const PER_MEMBER = 2
/** Streams across the relay, so idle connections cannot exhaust it. */
export const MAX_STREAMS = 2000
/** Comment lines keep proxies and mobile networks from closing an idle stream. */
export const PING_MS = 20_000

@Injectable()
export class Watchers implements OnModuleDestroy {
  private readonly streams = new Map<string, Response[]>()
  private count = 0

  constructor(@Inject(SyncStore) store: SyncStore) {
    store.onNudge = (group, members, nudge) => {
      for (const m of members) for (const res of this.streams.get(`${group}/${m}`) ?? []) send(res, nudge)
    }
  }

  get size(): number {
    return this.count
  }

  /** Turns `res` into an event stream for the member until the client goes away. */
  open(group: string, member: string, res: Response): void {
    const key = `${group}/${member}`
    const list = this.streams.get(key) ?? []
    if (list.length >= PER_MEMBER) list.shift()!.end()
    else if (this.count >= MAX_STREAMS) throw new SyncError(503, 'too_many_streams')
    else this.count++
    list.push(res)
    this.streams.set(key, list)

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    // Nginx-style proxies would otherwise buffer the stream.
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    send(res, 'ready')
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS)
    res.on('close', () => {
      clearInterval(ping)
      const current = this.streams.get(key)
      const i = current?.indexOf(res) ?? -1
      if (i < 0) return // replaced by a newer stream; already uncounted
      current!.splice(i, 1)
      if (!current!.length) this.streams.delete(key)
      this.count--
    })
  }

  /** Ends every stream, so shutting down does not wait for phones to hang up. */
  onModuleDestroy() {
    for (const list of this.streams.values()) for (const res of list) res.end()
  }
}

function send(res: Response, nudge: Nudge | 'ready') {
  res.write(`event: ${nudge}\ndata: {}\n\n`)
}
