import { GatewayManagementService } from '../../services/billing/gateway-management-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new GatewayManagementService().getSettings() }
})
