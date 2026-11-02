import { z } from 'zod'
import { ProxyGatewayService } from '../../../../services/billing/proxy-gateway-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return { data: await new ProxyGatewayService().get(id) }
})
