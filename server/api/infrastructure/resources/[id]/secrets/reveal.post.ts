import { InfrastructureTemplateService } from '../../../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const resourceId = getRouterParam(event, 'id')
  if (!resourceId) throw createError({ statusCode: 400, statusMessage: 'Resource ID wajib diisi.' })

  setResponseHeader(event, 'Cache-Control', 'no-store, private')
  setResponseHeader(event, 'Pragma', 'no-cache')
  return {
    data: await new InfrastructureTemplateService().revealResourceSecrets(
      resourceId,
      session.user.id,
    ),
  }
})
