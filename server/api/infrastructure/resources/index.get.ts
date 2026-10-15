import { NativeInfrastructureService } from '../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new NativeInfrastructureService().listResources() }
})
