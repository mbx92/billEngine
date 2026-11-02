import { z } from 'zod'
import { proxyGatewayPlanSchema } from '../../../../../shared/schemas/gateway'
import { ProxyGatewayService } from '../../../../services/billing/proxy-gateway-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = proxyGatewayPlanSchema.parse(await readBody(event))
  return { data: await new ProxyGatewayService().preview(id, input) }
})
