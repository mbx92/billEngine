import { nativeServiceDatabaseIdSchema } from '../../../../../../shared/schemas/native-service-databases'
import { NativeDatabaseClusterService } from '../../../../../services/infrastructure/native-database-cluster-service'
import { requireIdempotencyKey } from '../../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const allocationId = nativeServiceDatabaseIdSchema.parse(getRouterParam(event, 'id'))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new NativeDatabaseClusterService().createBackup(
    allocationId,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
