import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new CoolifyResourceService().listServers() }
})
