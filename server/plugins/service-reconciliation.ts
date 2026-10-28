import { withPostgresAdvisoryLock } from '../database/advisory-lock'
import { useDatabase } from '../database/client'
import { ServiceReconciliationService } from '../services/billing/service-reconciliation-service'

export default defineNitroPlugin((nitroApp) => {
  let running = false
  const execute = async () => {
    if (running) return
    running = true
    try {
      await withPostgresAdvisoryLock(useDatabase().$client, 814_210_733, () =>
        new ServiceReconciliationService().run(),
      )
    } catch (error) {
      console.error('[service-reconciliation]', error)
    } finally {
      running = false
    }
  }
  const startup = setTimeout(execute, 5_000)
  const interval = setInterval(execute, 30_000)
  startup.unref()
  interval.unref()
  nitroApp.hooks.hook('close', () => {
    clearTimeout(startup)
    clearInterval(interval)
  })
})
