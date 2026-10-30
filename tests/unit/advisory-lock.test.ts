import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Pool } from 'pg'
import { withPostgresAdvisoryLock } from '../../server/database/advisory-lock'

function setup(acquired: boolean) {
  const client = Object.assign(new EventEmitter(), {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired }] })
      .mockResolvedValue({ rows: [{ pg_advisory_unlock: true }] }),
    release: vi.fn(),
  })
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

  it('handles a lost lock connection while work uses other connections', async () => {
    const { client, pool } = setup(true)
    const failure = Object.assign(new Error('the database system is in recovery mode'), {
      code: '57P03',
    })

    await expect(
      withPostgresAdvisoryLock(pool, 42, async () => {
        client.emit('error', failure)
        return 'done'
      }),
    ).rejects.toBe(failure)
    expect(client.query).toHaveBeenCalledOnce()
    expect(client.release).toHaveBeenCalledWith(true)
    expect(client.listenerCount('error')).toBe(0)
  })

  it('destroys a connection that fails before acquiring the lock', async () => {
    const { client, pool } = setup(true)
    const failure = new Error('Connection terminated unexpectedly')
    client.query.mockReset().mockRejectedValue(failure)
    const work = vi.fn()

    await expect(withPostgresAdvisoryLock(pool, 42, work)).rejects.toBe(failure)
    expect(work).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledWith(true)
    expect(client.listenerCount('error')).toBe(0)
  })
})
