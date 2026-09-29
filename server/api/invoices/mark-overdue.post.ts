import { markOverdueSchema } from '../../../shared/schemas/invoices'
import { JobRunRepository } from '../../repositories/audit'
import { InvoiceService } from '../../services/invoices/invoice-service'
import { requestActor } from '../../utils/actor'
import { todayIsoDate } from '../../utils/clock'

/** Flags issued invoices past their due date. Idempotent by construction. */
export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const body = await readBody(event).catch(() => ({}))
  const input = markOverdueSchema.parse(body ?? {})
  const asOf = input.asOf ?? todayIsoDate()

  const jobRuns = new JobRunRepository()
  const jobRun = await jobRuns.start('invoice.overdue')

  try {
    const result = await new InvoiceService().markOverdue(asOf, requestActor(event, session.user.id))

    await jobRuns.finish(jobRun.id, {
      status: 'completed',
      processedCount: result.marked,
      metadata: { asOf },
    })

    return { data: { ...result, jobRunId: jobRun.id } }
  } catch (error) {
    await jobRuns.finish(jobRun.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'unknown error',
    })
    throw error
  }
})
