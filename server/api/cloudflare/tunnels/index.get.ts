import { CloudflareTunnelService } from '../../../services/cloudflare/tunnel-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new CloudflareTunnelService().overview() }
})
