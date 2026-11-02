import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import migrationJournal from '../../drizzle/migrations/meta/_journal.json'
import { checkDatabaseReadiness } from '../../server/database/readiness'

function poolWithResponses(...responses: Array<{ rows: unknown[] }>) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses.shift())),
  } as unknown as Pick<Pool, 'query'>
}

describe('database readiness', () => {
  it('is ready when the database, core tables, and latest migration exist', async () => {
    const relations = Array.from({ length: 24 }, () => ({ relation_name: 'present' }))
    const pool = poolWithResponses(
      { rows: [{ '?column?': 1 }] },
      { rows: relations },
      {
        rows: [
          {
            migration_count: String(migrationJournal.entries.length),
            latest_migration: String(
              Math.max(...migrationJournal.entries.map((entry) => entry.when)),
            ),
          },
        ],
      },
    )

    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({
      ready: true,
      checks: { database: 'ok', migrations: 'ok' },
    })
  })

  it('reports pending migrations when a required relation is missing', async () => {
    const pool = poolWithResponses(
      { rows: [{ '?column?': 1 }] },
      { rows: [{ relation_name: null }] },
    )

    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({
      ready: false,
      checks: { database: 'ok', migrations: 'pending' },
    })
  })

  it('does not report ready when the Coolify tables were removed by another branch', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockImplementationOnce((_sql, parameters: string[][]) => ({
        rows: parameters[0]!.map((name) => ({
          relation_name: name.startsWith('public.coolify_') ? null : name,
        })),
      }))
    await expect(checkDatabaseReadiness({ query } as never)).resolves.toMatchObject({
      ready: false,
      checks: { database: 'ok', migrations: 'pending' },
    })
    expect(query.mock.calls[1]?.[1]?.[0]).toContain('public.coolify_servers')
  })

  it('distinguishes a database connection failure', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Pick<Pool, 'query'>

    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({
      ready: false,
      checks: { database: 'error', migrations: 'unknown' },
    })
  })
})
