import { resourceMetricsQuerySchema } from '../../../shared/schemas/coolify'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { ids } = resourceMetricsQuerySchema.parse(getQuery(event))
  const data = await new CoolifyResourceService().usageMetrics(ids)

  return { data }
})
