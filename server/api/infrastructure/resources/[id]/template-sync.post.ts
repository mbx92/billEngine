import { syncInfrastructureTemplateSchema } from '../../../../../shared/schemas/infrastructure-templates'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'
import { InfrastructureTemplateService } from '../../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const resourceId = getRouterParam(event, 'id')
  if (!resourceId) throw createError({ statusCode: 400, statusMessage: 'Resource ID wajib diisi.' })
  const input = syncInfrastructureTemplateSchema.parse(await readBody(event))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new InfrastructureTemplateService().syncApplicationTemplate(
    resourceId,
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
