import { createNodeEnrollmentSchema } from '../../../../shared/schemas/infrastructure'
import { InfrastructureNodeService } from '../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createNodeEnrollmentSchema.parse(await readBody(event))
  const result = await new InfrastructureNodeService().createEnrollment(input, session.user.id)
  setResponseStatus(event, 201)
  return { data: result }
})
