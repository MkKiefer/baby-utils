import 'reflect-metadata'
import { Module, type DynamicModule, type INestApplication, type LogLevel } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core'
import type { NextFunction, Request, Response } from 'express'
import { ApiKeyGuard } from './auth.ts'
import { RelayErrorFilter } from './errors.filter.ts'
import { MIN_API_KEY_LENGTH, RELAY_OPTIONS, type RelayOptions } from './options.ts'
import { Limits, RateLimitGuard } from './rate-limit.ts'
import { SyncStore } from './store.ts'
import { SyncController } from './sync.controller.ts'
import { Watchers } from './watch.ts'

@Module({})
export class RelayModule {
  static forRoot(options: RelayOptions, store: SyncStore): DynamicModule {
    return {
      module: RelayModule,
      controllers: [SyncController],
      providers: [
        { provide: RELAY_OPTIONS, useValue: options },
        { provide: SyncStore, useValue: store },
        Limits,
        Watchers,
        // Global guards run in this order: throttle first, then the API key.
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: ApiKeyGuard },
        { provide: APP_FILTER, useClass: RelayErrorFilter },
      ],
    }
  }
}

/** Builds the relay app without listening, so tests can run it on a random port. */
export async function createApp(
  options: RelayOptions,
  store = new SyncStore(undefined, options.now),
  logger: LogLevel[] | false = false,
): Promise<INestApplication> {
  if (options.apiKey.length < MIN_API_KEY_LENGTH) {
    throw new Error(`API_KEY must be at least ${MIN_API_KEY_LENGTH} characters`)
  }
  // The controller reads bodies itself (see readJson), with the relay's size limit and codes.
  const app = await NestFactory.create(RelayModule.forRoot(options, store), { bodyParser: false, logger })
  const http = app.getHttpAdapter().getInstance() as { disable(setting: string): void }
  http.disable('x-powered-by')
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })
  // The app may use a sync server on another host than its own. Credentials are headers,
  // never cookies, so answering any origin exposes nothing.
  app.enableCors({
    origin: options.corsOrigins ?? true,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Api-Key'],
    maxAge: 600,
  })
  return app
}
