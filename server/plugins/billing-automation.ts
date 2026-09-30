import { BillingAutomationService } from '../services/billing/automation-service'
import { withPostgresAdvisoryLock } from '../database/advisory-lock'
import { useDatabase } from '../database/client'
import { EmailNotificationService } from '../services/notifications/email-notification-service'

const AUTOMATION_INTERVAL_MS = 60 * 60 * 1_000
const STARTUP_DELAY_MS = 15_000
const BILLING_AUTOMATION_LOCK_KEY = 814_210_731

export default defineNitroPlugin((nitroApp) => {
  let running = false

  const execute = async () => {
    if (running) return
    running = true
    try {
      const lock = await withPostgresAdvisoryLock(
        useDatabase().$client,
        BILLING_AUTOMATION_LOCK_KEY,
        async () => {
          const result = await new BillingAutomationService().run()
          const config = useRuntimeConfig()
          if (result.status === 'completed' && config.resendApiKey && config.emailFrom) {
            const notifications = new EmailNotificationService()
            for (const invoice of result.recurring.created) {
              await notifications
                .sendInvoice(invoice.invoiceId, 'invoice_issued')
                .catch((error) => console.error('[invoice-email]', error))
            }
            await notifications
              .sendReminders(result.recurring.asOf)
              .catch((error) => console.error('[invoice-reminders]', error))
          }
          return result
        },
      )

      if (!lock.acquired) {
        console.info('[billing-automation] skipped: another instance holds the scheduler lock')
      }
    } catch (error) {
      console.error('[billing-automation]', error)
    } finally {
      running = false
    }
  }

  const startupTimer = setTimeout(execute, STARTUP_DELAY_MS)
  const intervalTimer = setInterval(execute, AUTOMATION_INTERVAL_MS)
  startupTimer.unref()
  intervalTimer.unref()

  nitroApp.hooks.hook('close', () => {
    clearTimeout(startupTimer)
    clearInterval(intervalTimer)
  })
})
