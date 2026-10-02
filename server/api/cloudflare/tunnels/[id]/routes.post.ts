import {
  cloudflareTunnelIdSchema,
  createCloudflareTunnelRouteSchema,
} from '../../../../../shared/schemas/cloudflare-tunnels'
import { CloudflareTunnelService } from '../../../../services/cloudflare/tunnel-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const tunnelId = cloudflareTunnelIdSchema.parse(getRouterParam(event, 'id'))
  const input = createCloudflareTunnelRouteSchema.parse(await readBody(event))
  const data = await new CloudflareTunnelService().addRoute(
    tunnelId,
    input,
    requestActor(event, session.user.id),
  )
  setResponseStatus(event, 201)
  return { data }
})
