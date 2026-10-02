import {
  cloudflareTunnelIdSchema,
  updateCloudflareTunnelRouteSchema,
} from '../../../../../shared/schemas/cloudflare-tunnels'
import { CloudflareTunnelService } from '../../../../services/cloudflare/tunnel-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const tunnelId = cloudflareTunnelIdSchema.parse(getRouterParam(event, 'id'))
  const input = updateCloudflareTunnelRouteSchema.parse(await readBody(event))
  return {
    data: await new CloudflareTunnelService().updateRoute(
      tunnelId,
      input.original,
      input.route,
      requestActor(event, session.user.id),
    ),
  }
})
