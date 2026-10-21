import { operationLogAppendSchema } from '../../../../../../shared/schemas/infrastructure'
import { NativeInfrastructureService } from '../../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const identity = await requireAgent(event)
  const operationId = getRouterParam(event, 'id')
  if (!operationId) {
    throw createError({ statusCode: 400, statusMessage: 'Operation ID wajib diisi.' })
  }
  const input = operationLogAppendSchema.parse(await readBody(event))
  return {
    data: await new NativeInfrastructureService().appendOperationLogs(
      identity.nodeId,
      operationId,
      input,
    ),
  }
})
