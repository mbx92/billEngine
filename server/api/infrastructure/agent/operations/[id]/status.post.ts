import { operationStatusUpdateSchema } from '../../../../../../shared/schemas/infrastructure'
import { NativeInfrastructureService } from '../../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const identity = await requireAgent(event)
  const operationId = getRouterParam(event, 'id')
  if (!operationId)
    throw createError({ statusCode: 400, statusMessage: 'Operation ID wajib diisi.' })
  const input = operationStatusUpdateSchema.parse(await readBody(event))
  return {
    data: await new NativeInfrastructureService().recordOperationStatus(
      identity.nodeId,
      operationId,
      input,
    ),
  }
})
