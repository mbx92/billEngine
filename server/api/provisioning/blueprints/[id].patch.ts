import {
  deploymentBlueprintIdSchema,
  updateDeploymentBlueprintSchema,
} from '../../../../shared/schemas/provisioning'
import { ProvisioningService } from '../../../services/provisioning/provisioning-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = deploymentBlueprintIdSchema.parse(getRouterParam(event, 'id'))
  const input = updateDeploymentBlueprintSchema.parse(await readBody(event))
  return { data: await new ProvisioningService().updateBlueprint(id, input) }
})
