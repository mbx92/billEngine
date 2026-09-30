import { reportRangeSchema } from '../../../shared/schemas/reports'
import { ReportService } from '../../services/reports/report-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const range = reportRangeSchema.parse(getQuery(event))
  const csv = await new ReportService().csv(range)
  const suffix = [range.from, range.to].filter(Boolean).join('_') || 'all'
  setResponseHeaders(event, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="billing-report-${suffix}.csv"`,
    'cache-control': 'private, no-store',
  })
  return `\uFEFF${csv}`
})
