import { z } from 'zod'
import { updateContainerRegistrySchema } from '../../../../shared/schemas/releases'
import { InfrastructureReleaseService } from '../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const registryId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = updateContainerRegistrySchema.parse(await readBody(event))
  return {
    data: await new InfrastructureReleaseService().updateRegistry(
      registryId,
      input,
      session.user.id,
    ),
  }
})
