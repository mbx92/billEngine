import { withPostgresAdvisoryLock } from '../database/advisory-lock'
import { useDatabase } from '../database/client'
import { ServiceReconciliationService } from '../services/billing/service-reconciliation-service'
import { scheduleDatabaseJob } from '../utils/database-job'

export default defineNitroPlugin((nitroApp) => {
  const stop = scheduleDatabaseJob({
    name: 'service-reconciliation',
    startupDelayMs: 5_000,
    intervalMs: 30_000,
    execute: async () => {
      await withPostgresAdvisoryLock(useDatabase().$client, 814_210_733, () =>
        new ServiceReconciliationService().run(),
      )
    },
  })
  nitroApp.hooks.hook('close', stop)
})
