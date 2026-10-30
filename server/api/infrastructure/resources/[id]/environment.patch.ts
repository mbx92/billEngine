import { updateApplicationEnvironmentSchema } from '../../../../../shared/schemas/application-environment'
import { ApplicationEnvironmentService } from '../../../../services/infrastructure/application-environment-service'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const resourceId = getRouterParam(event, 'id')
  if (!resourceId) throw createError({ statusCode: 400, statusMessage: 'Resource ID wajib diisi.' })
  const input = updateApplicationEnvironmentSchema.parse(await readBody(event))
  const key = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const data = await new ApplicationEnvironmentService().update(
    resourceId,
    input,
    session.user.id,
    key,
  )
  setResponseHeader(event, 'Cache-Control', 'no-store, private')
  setResponseStatus(event, data.replayed ? 200 : 202)
  return { data }
})
