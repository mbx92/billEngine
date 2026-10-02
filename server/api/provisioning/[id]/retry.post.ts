import { ProvisioningService } from '../../../services/provisioning/provisioning-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Job ID wajib diisi.' })
  return { data: await new ProvisioningService().retry(id) }
})
