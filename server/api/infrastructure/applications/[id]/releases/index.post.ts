import { z } from 'zod'
import { createApplicationReleaseSchema } from '../../../../../../shared/schemas/releases'
import { InfrastructureReleaseService } from '../../../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const applicationId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = createApplicationReleaseSchema.parse(await readBody(event))
  const release = await new InfrastructureReleaseService().createRelease(
    applicationId,
    input,
    session.user.id,
  )
  setResponseStatus(event, 201)
  return { data: release }
})
