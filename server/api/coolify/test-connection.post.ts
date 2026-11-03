import { z } from 'zod'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { serverId } = z.object({ serverId: z.uuid() }).parse(await readBody(event))
  const connected = await new CoolifyResourceService().testConnection(serverId)
  return { data: { connected } }
})
