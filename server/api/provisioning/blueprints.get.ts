import { ProvisioningService } from '../../services/provisioning/provisioning-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new ProvisioningService().blueprintCatalog() }
})
