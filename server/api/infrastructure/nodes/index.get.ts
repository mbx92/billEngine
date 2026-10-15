import { InfrastructureNodeService } from '../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new InfrastructureNodeService().listNodes() }
})
