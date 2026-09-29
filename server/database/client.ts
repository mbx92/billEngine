import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

let database: Database | undefined

function createDatabase() {
  const config = useRuntimeConfig()

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured.')
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl })
  return drizzle(pool, { schema })
}

export type Database = ReturnType<typeof createDatabase>

/**
 * A Drizzle transaction handle. It exposes the same query builder surface as
 * `Database` but lacks `$client`, which is why repositories accept it
 * explicitly wherever they must run inside a caller's transaction.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export function useDatabase(): Database {
  database ??= createDatabase()
  return database
}
