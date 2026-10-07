import { uuidSchema } from '../../../shared/schemas/common'
import { ServiceCatalogService } from '../../services/services/service-catalog-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const service = await new ServiceCatalogService().removeCancelled(
    id,
    requestActor(event, session.user.id),
  )
  return { data: service }
})
