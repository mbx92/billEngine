import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import * as schema from './schema'
import { createPostgresPool } from './pool'

function createDatabase() {
  const config = useRuntimeConfig()

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured.')
  }

  const holder = globalThis as typeof globalThis & { __ocInfrastructurePool?: pg.Pool }
  holder.__ocInfrastructurePool ??= createPostgresPool(config.databaseUrl)
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
