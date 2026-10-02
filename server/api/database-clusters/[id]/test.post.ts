import { databaseClusterIdSchema } from '../../../../shared/schemas/database-provisioning'
import { DatabaseClusterService } from '../../../services/database/database-cluster-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = databaseClusterIdSchema.parse(getRouterParam(event, 'id'))
  return { data: await new DatabaseClusterService().test(id) }
})
