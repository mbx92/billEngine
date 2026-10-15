import { z } from 'zod'
import { NativeInfrastructureService } from '../../../services/infrastructure/native-service'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = querySchema.parse(getQuery(event))
  const data = await new NativeInfrastructureService().listOperations(query.limit)
  return { data }
})
