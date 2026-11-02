import { gatewaySettingsSchema } from '../../../shared/schemas/gateway'
import { GatewayManagementService } from '../../services/billing/gateway-management-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = gatewaySettingsSchema.parse(await readBody(event))
  return {
    data: await new GatewayManagementService().saveSettings(
      input,
      requestActor(event, session.user.id),
    ),
  }
})
