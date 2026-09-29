import { resourceListQuerySchema } from '../../../shared/schemas/coolify'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = resourceListQuerySchema.parse(getQuery(event))
  const service = new CoolifyResourceService()
  const [{ rows, total }, summary] = await Promise.all([service.list(input), service.summary()])

  return {
    data: rows,
    summary,
    meta: {
      page: input.page,
      perPage: input.perPage,
      total,
      totalPages: Math.ceil(total / input.perPage),
    },
  }
})
