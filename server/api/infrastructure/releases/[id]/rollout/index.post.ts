import { z } from 'zod'
import { rolloutApplicationReleaseSchema } from '../../../../../../shared/schemas/releases'
import { InfrastructureReleaseService } from '../../../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const releaseId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = rolloutApplicationReleaseSchema.parse(await readBody(event))
  const operations = await new InfrastructureReleaseService().rollout(
    releaseId,
    input,
    session.user.id,
  )
  setResponseStatus(event, 202)
  return { data: { operations, operationsQueued: operations.length } }
})
