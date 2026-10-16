import { withPostgresAdvisoryLock } from '../database/advisory-lock'
import { useDatabase } from '../database/client'
import { InfrastructureBackupService } from '../services/infrastructure/backup-service'

const BACKUP_INTERVAL_MS = 60_000
const STARTUP_DELAY_MS = 20_000
const BACKUP_AUTOMATION_LOCK_KEY = 814_210_732

export default defineNitroPlugin((nitroApp) => {
  let running = false
  const execute = async () => {
    if (running) return
    running = true
    try {
      const lock = await withPostgresAdvisoryLock(
        useDatabase().$client,
        BACKUP_AUTOMATION_LOCK_KEY,
        () => new InfrastructureBackupService().runScheduled(),
      )
      if (!lock.acquired) {
        console.info('[backup-automation] skipped: another instance holds the scheduler lock')
      }
    } catch (error) {
      console.error('[backup-automation]', error)
    } finally {
      running = false
    }
  }

  const startupTimer = setTimeout(execute, STARTUP_DELAY_MS)
  const intervalTimer = setInterval(execute, BACKUP_INTERVAL_MS)
  startupTimer.unref()
  intervalTimer.unref()
  nitroApp.hooks.hook('close', () => {
    clearTimeout(startupTimer)
    clearInterval(intervalTimer)
  })
})
