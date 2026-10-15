import { InfrastructureTemplateService } from '../../../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  const identity = await requireAgent(event)
  const operationId = getRouterParam(event, 'id')
  if (!operationId) throw createError({ statusCode: 400, statusMessage: 'Operation ID wajib diisi.' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')
  return { data: await new InfrastructureTemplateService().operationSecrets(identity.nodeId, operationId) }
})
