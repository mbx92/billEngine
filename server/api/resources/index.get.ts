import { paginationSchema } from '../../../shared/schemas/common'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { page, perPage } = paginationSchema.parse(getQuery(event))
  const service = new CoolifyResourceService()
  const [{ rows, total }, summary] = await Promise.all([
    service.list(page, perPage),
    service.summary(),
  ])

  return {
    data: rows,
    summary,
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  }
})
