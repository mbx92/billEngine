import {
  databaseClusterIdSchema,
  updateDatabaseClusterSchema,
} from '../../../shared/schemas/database-provisioning'
import { DatabaseClusterService } from '../../services/database/database-cluster-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = databaseClusterIdSchema.parse(getRouterParam(event, 'id'))
  const input = updateDatabaseClusterSchema.parse(await readBody(event))
  return { data: await new DatabaseClusterService().update(id, input) }
})
