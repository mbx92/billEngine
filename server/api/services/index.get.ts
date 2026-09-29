import { paginationSchema } from '../../../shared/schemas/common'
import { ServiceCatalogService } from '../../services/services/service-catalog-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { page, perPage } = paginationSchema.parse(getQuery(event))
  const { rows, total } = await new ServiceCatalogService().list(page, perPage)

  return {
    data: rows,
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  }
})
