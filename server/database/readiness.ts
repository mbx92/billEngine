import type { Pool } from 'pg'
import migrationJournal from '../../drizzle/migrations/meta/_journal.json'

const REQUIRED_TABLES = [
  'users',
  'customers',
  'plans',
  'services',
  'invoices',
  'payments',
  'credit_notes',
  'email_deliveries',
  'audit_logs',
  'resource_domains',
] as const

const EXPECTED_MIGRATION_COUNT = migrationJournal.entries.length
const LATEST_MIGRATION_TIMESTAMP = Math.max(...migrationJournal.entries.map((entry) => entry.when))

export interface ReadinessResult {
  ready: boolean
  checks: {
    database: 'ok' | 'error'
    migrations: 'ok' | 'pending' | 'unknown'
  }
}

/** Checks connectivity, migration history, and the core tables needed to serve traffic. */
export async function checkDatabaseReadiness(pool: Pick<Pool, 'query'>): Promise<ReadinessResult> {
  try {
    await pool.query('select 1')
  } catch {
    return {
      ready: false,
      checks: { database: 'error', migrations: 'unknown' },
    }
  }

  try {
    const relationNames = [
      'drizzle.__drizzle_migrations',
      ...REQUIRED_TABLES.map((name) => `public.${name}`),
    ]
    const relationResult = await pool.query<{ relation_name: string | null }>(
      `select requested_name, to_regclass(requested_name)::text as relation_name
         from unnest($1::text[]) as requested_name`,
      [relationNames],
    )
    const allRelationsExist =
      relationResult.rows.length === relationNames.length &&
      relationResult.rows.every((row) => row.relation_name !== null)

    if (!allRelationsExist) {
      return {
        ready: false,
        checks: { database: 'ok', migrations: 'pending' },
      }
    }

    const migrationResult = await pool.query<{
      migration_count: string
      latest_migration: string | null
    }>(
      `select count(*)::text as migration_count,
              max(created_at)::text as latest_migration
         from drizzle.__drizzle_migrations`,
    )
    const row = migrationResult.rows[0]
    const migrationCount = Number(row?.migration_count ?? 0)
    const latestMigration = Number(row?.latest_migration ?? 0)
    const migrationsReady =
      migrationCount >= EXPECTED_MIGRATION_COUNT && latestMigration >= LATEST_MIGRATION_TIMESTAMP

    return {
      ready: migrationsReady,
      checks: { database: 'ok', migrations: migrationsReady ? 'ok' : 'pending' },
    }
  } catch {
    return {
      ready: false,
      checks: { database: 'ok', migrations: 'pending' },
    }
  }
}
