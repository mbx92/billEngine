import { withPostgresAdvisoryLock } from '../database/advisory-lock'
import { useDatabase } from '../database/client'
import { InfrastructureBackupService } from '../services/infrastructure/backup-service'
import { scheduleDatabaseJob } from '../utils/database-job'

const BACKUP_INTERVAL_MS = 60_000
const STARTUP_DELAY_MS = 20_000
const BACKUP_AUTOMATION_LOCK_KEY = 814_210_732

export default defineNitroPlugin((nitroApp) => {
  const stop = scheduleDatabaseJob({
    name: 'backup-automation',
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: BACKUP_INTERVAL_MS,
    execute: async () => {
      const lock = await withPostgresAdvisoryLock(
        useDatabase().$client,
        BACKUP_AUTOMATION_LOCK_KEY,
        () => new InfrastructureBackupService().runScheduled(),
      )
      if (!lock.acquired) {
        console.info('[backup-automation] skipped: another instance holds the scheduler lock')
      }
    },
  })
  nitroApp.hooks.hook('close', stop)
})
