import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleDatabaseJob } from '../../server/utils/database-job'
import { isTransientDatabaseError } from '../../server/database/connection-errors'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('database recovery scheduling', () => {
  it('recognizes recovery errors through Drizzle/h3 wrappers without hiding SQL errors', () => {
    expect(isTransientDatabaseError({ cause: { cause: { code: '57P03' } } })).toBe(true)
    expect(isTransientDatabaseError(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isTransientDatabaseError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isTransientDatabaseError({ code: '28P01', message: 'invalid password' })).toBe(false)
    const cycle: { cause?: unknown } = {}
    cycle.cause = cycle
    expect(isTransientDatabaseError(cycle)).toBe(false)
  })

  it('backs off recovery failures, resumes the normal interval, and stops on shutdown', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ code: '57P03' })
      .mockRejectedValueOnce({ cause: { code: '57P03' } })
      .mockResolvedValue(undefined)
    const stop = scheduleDatabaseJob({
      name: 'job',
      startupDelayMs: 100,
      intervalMs: 60_000,
      execute,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(execute).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(execute).toHaveBeenCalledTimes(4)
    stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('does not overlap work or reschedule in-flight work after shutdown', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const stop = scheduleDatabaseJob({ name: 'job', startupDelayMs: 0, intervalMs: 100, execute })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(execute).toHaveBeenCalledTimes(1)
    stop()
    finish()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('logs non-transient errors and keeps the normal interval', async () => {
    vi.useFakeTimers()
    const failure = new Error('invalid configuration')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const execute = vi.fn().mockRejectedValue(failure)
    const stop = scheduleDatabaseJob({
      name: 'job',
      startupDelayMs: 0,
      intervalMs: 60_000,
      execute,
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[job]', failure)
    stop()
  })
})
