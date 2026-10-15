import { updateApplicationResourceSchema } from '../../../../../shared/schemas/infrastructure'
import {
  NativeInfrastructureService,
  requireIdempotencyKey,
} from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const resourceId = getRouterParam(event, 'id')
  if (!resourceId) throw createError({ statusCode: 400, statusMessage: 'Resource ID wajib diisi.' })
  const input = updateApplicationResourceSchema.parse(await readBody(event))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new NativeInfrastructureService().updateApplication(
    resourceId,
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
