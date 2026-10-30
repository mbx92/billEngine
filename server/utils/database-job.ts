import { isTransientDatabaseError } from '../database/connection-errors'

/** Schedule one pass at a time and retry temporary DB outages sooner than the normal interval. */
export function scheduleDatabaseJob(options: {
  name: string
  startupDelayMs: number
  intervalMs: number
  execute: () => Promise<unknown>
}) {
  let stopped = false
  let failures = 0
  let lastWarningAt = 0
  let timer: ReturnType<typeof setTimeout>

  function schedule(wait: number) {
    timer = setTimeout(run, wait)
    timer.unref()
  }

  async function run() {
    if (stopped) return
    let nextDelay = options.intervalMs
    try {
      await options.execute()
      if (failures) console.info(`[${options.name}] database recovered; scheduler resumed.`)
      failures = 0
    } catch (error) {
      if (isTransientDatabaseError(error)) {
        nextDelay = Math.min(5_000 * 2 ** Math.min(failures, 4), 60_000)
        failures++
        const now = Date.now()
        if (failures === 1 || now - lastWarningAt >= 60_000) {
          console.warn(
            `[${options.name}] PostgreSQL temporarily unavailable; retrying in ${nextDelay / 1_000}s.`,
          )
          lastWarningAt = now
        }
      } else {
        failures = 0
        console.error(`[${options.name}]`, error)
      }
    } finally {
      if (!stopped) schedule(nextDelay)
    }
  }

  schedule(options.startupDelayMs)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
