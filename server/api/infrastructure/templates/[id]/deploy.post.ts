import { deployInfrastructureTemplateSchema } from '../../../../../shared/schemas/infrastructure-templates'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'
import { InfrastructureTemplateService } from '../../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const templateId = getRouterParam(event, 'id')
  if (!templateId) throw createError({ statusCode: 400, statusMessage: 'Template ID wajib diisi.' })
  const input = deployInfrastructureTemplateSchema.parse(await readBody(event))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new InfrastructureTemplateService().deploy(
    templateId,
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
