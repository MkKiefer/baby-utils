import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'
import { SyncError } from './store.ts'

/** Every error answers `{ error: <code> }`, which the app maps to a message. */
@Catch()
export class RelayErrorFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    let status = 500
    let code = 'internal'
    if (e instanceof SyncError) {
      status = e.status
      code = e.code
    } else if (e instanceof HttpException) {
      status = e.getStatus()
      code = status === HttpStatus.NOT_FOUND ? 'not_found' : `http_${status}`
    } else {
      console.error('relay error:', (e as Error)?.message ?? e)
    }
    if (status === 429) res.setHeader('Retry-After', '60')
    res.status(status).json({ error: code })
  }
}
