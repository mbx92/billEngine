import { bulkUpdateResourceClassificationSchema } from '../../../shared/schemas/coolify'
import { CoolifyResourceService } from '../../services/coolify/resource-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = bulkUpdateResourceClassificationSchema.parse(await readBody(event))
  const service = new CoolifyResourceService()
  const data = await service.updateClassifications(input, requestActor(event, session.user.id))
  const summary = await service.summary()

  return { data, summary }
})
