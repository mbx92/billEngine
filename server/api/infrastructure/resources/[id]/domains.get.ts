import { z } from 'zod'
import { ApplicationDomainService } from '../../../../services/infrastructure/application-domain-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = z.string().uuid().parse(getRouterParam(event, 'id'))
  setResponseHeader(event, 'Cache-Control', 'no-store, private')
  return { data: await new ApplicationDomainService().read(resourceId) }
})
