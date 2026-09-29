import { z } from 'zod'
import { updateResourceClassificationSchema } from '../../../shared/schemas/coolify'
import { CoolifyResourceService } from '../../services/coolify/resource-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const resourceId = z.uuid().parse(getRouterParam(event, 'id'))
  const input = updateResourceClassificationSchema.parse(await readBody(event))
  const service = new CoolifyResourceService()
  const data = await service.updateClassification(
    resourceId,
    input,
    requestActor(event, session.user.id),
  )
  const summary = await service.summary()

  return { data, summary }
})
