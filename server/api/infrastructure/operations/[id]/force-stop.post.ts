import { operationIdSchema } from '../../../../../shared/schemas/infrastructure'
import { NativeInfrastructureService } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const operationId = operationIdSchema.parse(getRouterParam(event, 'id'))
  return {
    data: await new NativeInfrastructureService().forceStopOperation(
      operationId,
      session.user.id,
    ),
  }
})
