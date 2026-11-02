import { z } from 'zod'
import { GatewayManagementService } from '../../../services/billing/gateway-management-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return { data: await new GatewayManagementService().preview(id) }
})
