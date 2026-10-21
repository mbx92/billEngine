import { z } from 'zod'
import { NativeInfrastructureService } from '../../../../../services/infrastructure/native-service'

const identifierSchema = z.string().uuid()

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = identifierSchema.parse(getRouterParam(event, 'id'))
  const operationId = identifierSchema.parse(getRouterParam(event, 'operationId'))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    data: await new NativeInfrastructureService().containerExecOperation(resourceId, operationId),
  }
})
