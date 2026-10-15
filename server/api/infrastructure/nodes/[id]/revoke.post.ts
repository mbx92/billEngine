import { InfrastructureNodeService } from '../../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const nodeId = getRouterParam(event, 'id')
  if (!nodeId) throw createError({ statusCode: 400, statusMessage: 'Node ID wajib diisi.' })

  return {
    data: await new InfrastructureNodeService().revoke(nodeId, session.user.id),
  }
})
