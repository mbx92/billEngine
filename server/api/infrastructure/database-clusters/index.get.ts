import { NativeDatabaseClusterService } from '../../../services/infrastructure/native-database-cluster-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new NativeDatabaseClusterService().overview() }
})
