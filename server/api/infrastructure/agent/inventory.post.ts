import { agentInventorySchema } from '../../../../shared/schemas/infrastructure'
import { InfrastructureNodeService } from '../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  const identity = await requireAgent(event)
  const input = agentInventorySchema.parse(await readBody(event))
  return { data: await new InfrastructureNodeService().inventory(identity.nodeId, input) }
})
