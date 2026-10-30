import { ApplicationEnvironmentService } from '../../../../services/infrastructure/application-environment-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = getRouterParam(event, 'id')
  if (!resourceId) throw createError({ statusCode: 400, statusMessage: 'Resource ID wajib diisi.' })
  setResponseHeader(event, 'Cache-Control', 'no-store, private')
  return { data: await new ApplicationEnvironmentService().read(resourceId) }
})
