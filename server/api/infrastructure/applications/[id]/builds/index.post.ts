import { z } from 'zod'
import { queueApplicationBuildSchema } from '../../../../../../shared/schemas/releases'
import { ApplicationBuildService } from '../../../../../services/infrastructure/application-build-service'
import { requireIdempotencyKey } from '../../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const applicationId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = queueApplicationBuildSchema.parse((await readBody(event)) ?? {})
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'Idempotency-Key'))
  const result = await new ApplicationBuildService().queue(
    applicationId,
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
