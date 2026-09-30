import { reportRangeSchema } from '../../../shared/schemas/reports'
import { ReportService } from '../../services/reports/report-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const range = reportRangeSchema.parse(getQuery(event))
  return { data: await new ReportService().summary(range) }
})
