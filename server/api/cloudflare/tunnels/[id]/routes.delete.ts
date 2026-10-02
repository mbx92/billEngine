import {
  cloudflareTunnelIdSchema,
  deleteCloudflareTunnelRouteSchema,
} from '../../../../../shared/schemas/cloudflare-tunnels'
import { CloudflareTunnelService } from '../../../../services/cloudflare/tunnel-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const tunnelId = cloudflareTunnelIdSchema.parse(getRouterParam(event, 'id'))
  const input = deleteCloudflareTunnelRouteSchema.parse(await readBody(event))
  return {
    data: await new CloudflareTunnelService().removeRoute(
      tunnelId,
      input,
      requestActor(event, session.user.id),
    ),
  }
})
