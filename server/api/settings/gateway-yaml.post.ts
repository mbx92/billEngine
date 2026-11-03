import { readBody, setResponseHeader } from 'h3'
import { gatewaySettingsSchema } from '../../../shared/schemas/gateway'
import { GatewayManagementService } from '../../services/billing/gateway-management-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')
  const input = gatewaySettingsSchema.partial().parse((await readBody(event)) ?? {})
  return { data: await new GatewayManagementService().generateYaml(input) }
})
