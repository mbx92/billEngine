import { createDeploymentBlueprintSchema } from '../../../shared/schemas/provisioning'
import { ProvisioningService } from '../../services/provisioning/provisioning-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createDeploymentBlueprintSchema.parse(await readBody(event))
  const result = await new ProvisioningService().createBlueprint(input, {
    userId: session.user.id,
  })
  setResponseStatus(event, 201)
  return { data: result }
})
