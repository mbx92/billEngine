import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { checkDatabaseReadiness } from '../../server/database/readiness'

function poolWithResponses(...responses: Array<{ rows: unknown[] }>) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve(responses.shift())),
  } as unknown as Pick<Pool, 'query'>
}

describe('database readiness', () => {
  it('is ready when the database, core tables, and latest migration exist', async () => {
    const relations = Array.from({ length: 10 }, () => ({ relation_name: 'present' }))
    const pool = poolWithResponses(
      { rows: [{ '?column?': 1 }] },
      { rows: relations },
      { rows: [{ migration_count: '6', latest_migration: '1790755287840' }] },
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
