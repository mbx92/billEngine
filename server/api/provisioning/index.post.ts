import { queueProvisioningJobSchema } from '../../../shared/schemas/provisioning'
import { ProvisioningService } from '../../services/provisioning/provisioning-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = queueProvisioningJobSchema.parse(await readBody(event))
  const result = await new ProvisioningService().queue(input, { userId: session.user.id })
  setResponseStatus(event, 202)
  return { data: result }
})
