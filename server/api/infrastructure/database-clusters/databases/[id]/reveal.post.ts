import { nativeServiceDatabaseIdSchema } from '../../../../../../shared/schemas/native-service-databases'
import { NativeDatabaseClusterService } from '../../../../../services/infrastructure/native-database-cluster-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const allocationId = nativeServiceDatabaseIdSchema.parse(getRouterParam(event, 'id'))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')
  return {
    data: await new NativeDatabaseClusterService().revealServiceDatabase(
      allocationId,
      session.user.id,
    ),
  }
})
