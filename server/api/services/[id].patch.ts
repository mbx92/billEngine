import { uuidSchema } from '../../../shared/schemas/common'
import { updateServiceSchema } from '../../../shared/schemas/services'
import { ServiceCatalogService } from '../../services/services/service-catalog-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = updateServiceSchema.parse(await readBody(event))
  const service = await new ServiceCatalogService().update(
    id,
    input,
    requestActor(event, session.user.id),
  )

  return { data: { id: service.id, status: service.status } }
})
