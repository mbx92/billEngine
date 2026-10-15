import { createContainerRegistrySchema } from '../../../../shared/schemas/releases'
import { InfrastructureReleaseService } from '../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createContainerRegistrySchema.parse(await readBody(event))
  const registry = await new InfrastructureReleaseService().createRegistry(input, session.user.id)
  setResponseStatus(event, 201)
  return { data: registry }
})
