import { agentHeartbeatSchema } from '../../../../shared/schemas/infrastructure'
import { InfrastructureNodeService } from '../../../services/infrastructure/node-service'

export default defineEventHandler(async (event) => {
  const identity = await requireAgent(event)
  const input = agentHeartbeatSchema.parse(await readBody(event))
  return { data: await new InfrastructureNodeService().heartbeat(identity.nodeId, input) }
})
