import { deploymentBlueprintIdSchema } from '../../../../shared/schemas/provisioning'
import { ProvisioningService } from '../../../services/provisioning/provisioning-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = deploymentBlueprintIdSchema.parse(getRouterParam(event, 'id'))
  return { data: await new ProvisioningService().deleteBlueprint(id) }
})
