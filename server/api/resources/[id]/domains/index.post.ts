import { createResourceDomainSchema } from '../../../../../shared/schemas/coolify'
import { uuidSchema } from '../../../../../shared/schemas/common'
import { ResourceDomainService } from '../../../../services/domains/resource-domain-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = createResourceDomainSchema.parse(await readBody(event))
  const data = await new ResourceDomainService().create(resourceId, input)
  setResponseStatus(event, 201)
  return { data }
})
