import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { isTransientDatabaseError } from './connection-errors'

const CONNECTION_RETRY_DELAYS_MS = [500, 1_000, 2_000] as const

export function createPostgresPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  let interrupted = false
  let lastWarningAt = 0

  function reportUnavailable() {
    const now = Date.now()
    if (!interrupted || now - lastWarningAt >= 60_000) {
      console.warn('[db] PostgreSQL connection interrupted; reconnecting with backoff.')
      lastWarningAt = now
    }
    interrupted = true
  }

  // pg automatically removes dead idle clients. Coalesce the errors from all
  // sockets affected by the same database restart/recovery into one warning.
  pool.on('error', (error) => {
    if (isTransientDatabaseError(error)) reportUnavailable()
    else console.error('[db] idle connection error:', error.message)
  })
  pool.on('connect', () => {
    if (!interrupted) return
    interrupted = false
    console.info('[db] PostgreSQL connection restored.')
  })

  const connect = pool.connect.bind(pool)
  async function acquire(): Promise<pg.PoolClient> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await connect()
      } catch (error) {
        if (!isTransientDatabaseError(error)) throw error
        reportUnavailable()
        const wait = CONNECTION_RETRY_DELAYS_MS[attempt]
        if (wait === undefined || pool.ending) throw error
        await delay(wait)
      }
    }
  }

  type ConnectCallback = (
    error: Error | undefined,
    client?: pg.PoolClient,
    release?: (error?: Error | boolean) => void,
  ) => void

  // Both pool.query (callback) and transactions/advisory locks (promise) use
  // connect. Retry only acquiring a connection, before any caller SQL runs.
  // Replaying pool.query after a dropped connection could duplicate a write
  // whose commit succeeded but whose response never reached this process.
  pool.connect = ((callback?: ConnectCallback) => {
    const pending = acquire()
    if (!callback) return pending
    void pending.then(
      (client) => callback(undefined, client, client.release),
      (error: Error) => callback(error, undefined, () => {}),
    )
  }) as pg.Pool['connect']

  return pool
}
