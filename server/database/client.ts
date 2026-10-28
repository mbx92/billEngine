import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

const transientConnectionCodes = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006',
])

function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (transientConnectionCodes.has(code)) return true
  return /connection terminated/i.test(error.message)
}

function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Drop idle sockets before Docker's port proxy resets them. A reset socket
    // otherwise fails the next query with "Connection terminated unexpectedly".
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })

  // An idle client that dies emits 'error'. With no listener Node reports it
  // as an unhandled exception and can take down the dev server.
  pool.on('error', (error) => {
    console.error('[db] idle connection dropped:', error.message)
  })

  const query = pool.query.bind(pool) as pg.Pool['query']
  pool.query = ((...args: unknown[]) => {
    const pending = query(...(args as Parameters<pg.Pool['query']>))
    if (pending == null || typeof (pending as Promise<unknown>).then !== 'function') {
      return pending
    }
    // Callback-style callers are notified by pg itself; don't also retry.
    if (typeof args.at(-1) === 'function') return pending

    return (pending as Promise<unknown>).catch((error: unknown) => {
      if (!isTransientConnectionError(error)) throw error
      return query(...(args as Parameters<pg.Pool['query']>))
    })
  }) as pg.Pool['query']

  return pool
}

function createDatabase() {
  const config = useRuntimeConfig()

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured.')
  }

  const holder = globalThis as typeof globalThis & { __ocInfrastructurePool?: pg.Pool }
  holder.__ocInfrastructurePool ??= createPool(config.databaseUrl)
  return drizzle(holder.__ocInfrastructurePool, { schema })
}

export type Database = ReturnType<typeof createDatabase>

/**
 * A Drizzle transaction handle. It exposes the same query builder surface as
 * `Database` but lacks `$client`, which is why repositories accept it
 * explicitly wherever they must run inside a caller's transaction.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export function useDatabase(): Database {
  const holder = globalThis as typeof globalThis & { __ocInfrastructureDatabase?: Database }
  holder.__ocInfrastructureDatabase ??= createDatabase()
  return holder.__ocInfrastructureDatabase
}
