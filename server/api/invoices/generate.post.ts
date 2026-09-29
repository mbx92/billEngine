import { generateRecurringInvoicesSchema } from '../../../shared/schemas/invoices'
import type { ApiRecurringRunResult } from '../../../shared/types/api'
import { JobRunRepository } from '../../repositories/audit'
import { InvoiceService } from '../../services/invoices/invoice-service'
import { requestActor } from '../../utils/actor'

/**
 * Recurring invoice generation. Safe to call repeatedly: `service_billing_runs`
 * makes a second run for the same period a no-op (docs §17).
 *
 * Behind a protected admin path for MVP; a scheduler/cron can call it with an
 * admin session once deployment wiring is added.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = generateRecurringInvoicesSchema.parse((await readBody(event).catch(() => ({}))) ?? {})

  const jobRuns = new JobRunRepository()
  const jobRun = await jobRuns.start('invoice.recurring')

  try {
    const result = await new InvoiceService().generateRecurring(
      input,
      requestActor(event, session.user.id),
    )

    await jobRuns.finish(jobRun.id, {
      status: 'completed',
      processedCount: result.processed,
      metadata: { created: result.created.length, skipped: result.skipped.length },
    })

    const response: ApiRecurringRunResult = { ...result, jobRunId: jobRun.id }
    return { data: response }
  } catch (error) {
    await jobRuns.finish(jobRun.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'unknown error',
    })
    throw error
  }
})
