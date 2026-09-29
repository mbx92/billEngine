import { createServiceSchema } from '../../../shared/schemas/services'
import { ServiceCatalogService } from '../../services/services/service-catalog-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createServiceSchema.parse(await readBody(event))
  const service = await new ServiceCatalogService().create(
    input,
    requestActor(event, session.user.id),
  )

  setResponseStatus(event, 201)
  return { data: service }
})
