import { cloudflareTunnelIdSchema } from '../../../../shared/schemas/cloudflare-tunnels'
import { CloudflareTunnelService } from '../../../services/cloudflare/tunnel-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const tunnelId = cloudflareTunnelIdSchema.parse(getRouterParam(event, 'id'))
  return { data: await new CloudflareTunnelService().detail(tunnelId) }
})
