import { z } from 'zod'
import { GatewayManagementService } from '../../../services/billing/gateway-management-service'
import { requestActor } from '../../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return {
    data: await new GatewayManagementService().verify(id, requestActor(event, session.user.id)),
  }
})
