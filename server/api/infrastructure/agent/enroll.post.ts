import { enrollNodeSchema } from '../../../../shared/schemas/infrastructure'
import { InfrastructureNodeService } from '../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  const input = enrollNodeSchema.parse(await readBody(event))
  const result = await new InfrastructureNodeService().enroll(input)
  setResponseStatus(event, 201)
  return { data: result }
})
