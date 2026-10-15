import { createNativeDatabaseClusterSchema } from '../../../../shared/schemas/native-database-clusters'
import { requireIdempotencyKey } from '../../../services/infrastructure/native-service'
import { NativeDatabaseClusterService } from '../../../services/infrastructure/native-database-cluster-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createNativeDatabaseClusterSchema.parse(await readBody(event))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new NativeDatabaseClusterService().activate(
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
