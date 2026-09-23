/** Runtime settings of the relay; `main.ts` reads them from the environment. */
export interface RelayOptions {
  /**
   * Shared secret every request must carry as `X-Api-Key` (except the liveness probe), so
   * only apps that were given the server secret can use the relay at all.
   */
  apiKey: string
  /** Requests per client per minute. A phone makes ~10 while the app is open. */
  requestsPerMinute?: number
  /** New groups per client per hour. */
  groupsPerHour?: number
  /** Origins allowed to call the API from a browser; `true` reflects any origin. */
  corsOrigins?: string[] | true
  now?: () => number
}

export const RELAY_OPTIONS = Symbol('RELAY_OPTIONS')

/** Shortest API key the relay accepts, so a placeholder or typo cannot open it up. */
export const MIN_API_KEY_LENGTH = 16
