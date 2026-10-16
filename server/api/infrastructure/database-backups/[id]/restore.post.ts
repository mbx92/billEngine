import { z } from 'zod'
import { NativeDatabaseClusterService } from '../../../../services/infrastructure/native-database-cluster-service'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const backupId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new NativeDatabaseClusterService().restoreBackup(
    backupId,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
