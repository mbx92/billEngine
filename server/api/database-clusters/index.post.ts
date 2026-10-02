import { createDatabaseClusterSchema } from '../../../shared/schemas/database-provisioning'
import { DatabaseClusterService } from '../../services/database/database-cluster-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = createDatabaseClusterSchema.parse(await readBody(event))
  const result = await new DatabaseClusterService().create(input)
  setResponseStatus(event, 201)
  return { data: result }
})
