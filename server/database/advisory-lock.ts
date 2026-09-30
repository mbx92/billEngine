import type { Pool } from 'pg'

export interface AdvisoryLockResult<T> {
  acquired: boolean
  result?: T
}

/**
 * Runs work while holding a PostgreSQL session advisory lock.
 *
 * Session locks are used deliberately: billing work opens its own transactions,
 * so a transaction-scoped lock acquired on another connection would be released
 * too early. The checked-out client is held until work finishes and the lock is
 * released on that same connection.
 */
export async function withPostgresAdvisoryLock<T>(
  pool: Pick<Pool, 'connect'>,
  lockKey: number,
  work: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const client = await pool.connect()
  let destroyConnection = false

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock($1) as acquired',
      [lockKey],
    )

    if (!lockResult.rows[0]?.acquired) return { acquired: false }

    let result: T | undefined
    let operationError: unknown
    let operationFailed = false

    try {
      result = await work()
    } catch (error) {
      operationError = error
      operationFailed = true
    }

    try {
      await client.query('select pg_advisory_unlock($1)', [lockKey])
    } catch (error) {
      // Never return a session to the pool if its lock could still be held.
      destroyConnection = true
      if (!operationFailed) operationError = error
      operationFailed = true
    }

    if (operationFailed) throw operationError
    return { acquired: true, result: result as T }
  } finally {
    client.release(destroyConnection)
  }
}
