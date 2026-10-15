import { provisionNativeServiceDatabaseSchema } from '../../../../../shared/schemas/native-service-databases'
import { NativeDatabaseClusterService } from '../../../../services/infrastructure/native-database-cluster-service'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const clusterId = getRouterParam(event, 'id')
  if (!clusterId) throw createError({ statusCode: 400, statusMessage: 'Cluster ID wajib diisi.' })
  const input = provisionNativeServiceDatabaseSchema.parse(await readBody(event))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new NativeDatabaseClusterService().provisionServiceDatabase(
    clusterId,
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
