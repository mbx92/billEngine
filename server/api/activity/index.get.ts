import { paginationSchema } from '../../../shared/schemas/common'
import { ActivityService } from '../../services/activity/activity-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { page, perPage } = paginationSchema.parse(getQuery(event))
  const service = new ActivityService()
  const [{ rows, total }, jobRuns] = await Promise.all([
    service.listAuditLogs(page, perPage),
    service.listJobRuns(),
  ])

  return {
    data: rows,
    jobRuns,
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  }
})
