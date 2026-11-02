import { z } from 'zod'
import { saveProxyGatewaySchema } from '../../../../../shared/schemas/gateway'
import { ProxyGatewayService } from '../../../../services/billing/proxy-gateway-service'
import { requestActor } from '../../../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = saveProxyGatewaySchema.parse(await readBody(event))
  return {
    data: await new ProxyGatewayService().save(id, input, requestActor(event, session.user.id)),
  }
})
