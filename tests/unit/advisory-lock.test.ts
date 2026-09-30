import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { withPostgresAdvisoryLock } from '../../server/database/advisory-lock'

function setup(acquired: boolean) {
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired }] })
      .mockResolvedValue({ rows: [{ pg_advisory_unlock: true }] }),
    release: vi.fn(),
  }
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pick<Pool, 'connect'>

  return { client, pool }
}

describe('PostgreSQL advisory lock', () => {
  it('runs work and unlocks on the same checked-out connection', async () => {
    const { client, pool } = setup(true)
    const work = vi.fn().mockResolvedValue('done')

    await expect(withPostgresAdvisoryLock(pool, 42, work)).resolves.toEqual({
      acquired: true,
      result: 'done',
    })
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'select pg_try_advisory_lock($1) as acquired',
      [42],
    )
    expect(client.query).toHaveBeenNthCalledWith(2, 'select pg_advisory_unlock($1)', [42])
    expect(client.release).toHaveBeenCalledWith(false)
  })

  it('skips work when another process owns the lock', async () => {
    const { client, pool } = setup(false)
    const work = vi.fn()

    await expect(withPostgresAdvisoryLock(pool, 42, work)).resolves.toEqual({ acquired: false })
    expect(work).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledOnce()
    expect(client.release).toHaveBeenCalledWith(false)
  })

  it('unlocks and releases the client when work fails', async () => {
    const { client, pool } = setup(true)
    const failure = new Error('billing failed')

    await expect(
      withPostgresAdvisoryLock(pool, 42, async () => Promise.reject(failure)),
    ).rejects.toBe(failure)
    expect(client.query).toHaveBeenNthCalledWith(2, 'select pg_advisory_unlock($1)', [42])
    expect(client.release).toHaveBeenCalledWith(false)
  })

  it('destroys the pooled connection if unlocking fails', async () => {
    const { client, pool } = setup(true)
    client.query.mockRejectedValueOnce(new Error('unlock failed'))

    await expect(withPostgresAdvisoryLock(pool, 42, async () => 'done')).rejects.toThrow(
      'unlock failed',
    )
    expect(client.release).toHaveBeenCalledWith(true)
  })
})
