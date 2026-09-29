import { JobRunRepository } from '../../repositories/audit'
import { SettingsService } from '../settings/settings-service'
import { InvoiceService } from '../invoices/invoice-service'
import { todayIsoDate } from '../../utils/clock'

const SYSTEM_ACTOR = { userId: null, userAgent: 'billing-automation' }

/**
 * Executes one idempotent billing automation pass. The recurring engine has a
 * unique service/period guard, so overlapping application instances cannot
 * create the same service invoice twice.
 */
export class BillingAutomationService {
  constructor(
    private readonly settings = new SettingsService(),
    private readonly invoices = new InvoiceService(),
    private readonly jobs = new JobRunRepository(),
  ) {}

  async run() {
    const settings = await this.settings.getBillingSettings()
    if (!settings.billingAutomationEnabled) return { status: 'disabled' as const }

    const job = await this.jobs.start('billing.automation')
    const asOf = todayIsoDate(settings.billingTimezone)

    try {
      const recurring = await this.invoices.generateRecurring({ asOf, limit: 500 }, SYSTEM_ACTOR)
      const overdue = await this.invoices.markOverdue(asOf, SYSTEM_ACTOR)

      await this.jobs.finish(job.id, {
        status: 'completed',
        processedCount: recurring.processed + overdue.marked,
        metadata: {
          asOf,
          invoicesCreated: recurring.created.length,
          servicesSkipped: recurring.skipped.length,
          invoicesMarkedOverdue: overdue.marked,
        },
      })

      return { status: 'completed' as const, recurring, overdue }
    } catch (error) {
      await this.jobs.finish(job.id, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'unknown error',
        metadata: { asOf },
      })
      throw error
    }
  }
}
