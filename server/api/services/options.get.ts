import { ServiceCatalogService } from '../../services/services/service-catalog-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new ServiceCatalogService().options() }
})
