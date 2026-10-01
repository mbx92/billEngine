import { uuidSchema } from '../../../../../../shared/schemas/common'
import { ResourceDomainService } from '../../../../../services/domains/resource-domain-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = uuidSchema.parse(getRouterParam(event, 'id'))
  const domainId = uuidSchema.parse(getRouterParam(event, 'domainId'))
  const data = await new ResourceDomainService().refresh(resourceId, domainId)
  return { data }
})
