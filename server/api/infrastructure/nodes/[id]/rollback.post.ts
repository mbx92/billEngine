import { InfrastructureNodeService } from '../../../../services/infrastructure/node-service'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const nodeId = getRouterParam(event, 'id')
  if (!nodeId) throw createError({ statusCode: 400, statusMessage: 'Node ID wajib diisi.' })
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new InfrastructureNodeService().rollbackAgent(
    nodeId,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
