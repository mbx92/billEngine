import { NativeInfrastructureService } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const identity = await requireAgent(event)
  const operation = await new NativeInfrastructureService().claimNextOperation(
    identity.nodeId,
    `agent:${identity.identityId}`,
  )
  return { data: operation }
})
