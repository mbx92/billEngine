import { z } from 'zod'
import { CoolifyResourceService } from '../../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return { data: await new CoolifyResourceService().deleteServer(id, session.user.id) }
})
