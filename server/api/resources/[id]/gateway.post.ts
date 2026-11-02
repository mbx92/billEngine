import { z } from 'zod'
import { saveResourceGateSchema } from '../../../../shared/schemas/gateway'
import { GatewayManagementService } from '../../../services/billing/gateway-management-service'
import { requestActor } from '../../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = saveResourceGateSchema.parse(await readBody(event))
  return {
    data: await new GatewayManagementService().save(
      id,
      input.revision,
      requestActor(event, session.user.id),
    ),
  }
})
