import { updateNodeRoleSchema } from '../../../../../shared/schemas/infrastructure'
import { InfrastructureNodeService } from '../../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const nodeId = getRouterParam(event, 'id')
  if (!nodeId) throw createError({ statusCode: 400, statusMessage: 'Node ID wajib diisi.' })
  const input = updateNodeRoleSchema.parse(await readBody(event))

  return {
    data: await new InfrastructureNodeService().updateRole(nodeId, input, session.user.id),
  }
})
