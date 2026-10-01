import { uuidSchema } from '../../../../../shared/schemas/common'
import { ResourceDomainService } from '../../../../services/domains/resource-domain-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = uuidSchema.parse(getRouterParam(event, 'id'))
  return new ResourceDomainService().list(resourceId)
})
