import { DatabaseClusterService } from '../../services/database/database-cluster-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new DatabaseClusterService().overview() }
})
