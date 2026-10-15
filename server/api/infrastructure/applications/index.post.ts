import { createDeployableApplicationSchema } from '../../../../shared/schemas/releases'
import { InfrastructureReleaseService } from '../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createDeployableApplicationSchema.parse(await readBody(event))
  const application = await new InfrastructureReleaseService().createApplication(
    input,
    session.user.id,
  )
  setResponseStatus(event, 201)
  return { data: application }
})
