import { InfrastructureReleaseService } from '../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new InfrastructureReleaseService().catalog() }
})
