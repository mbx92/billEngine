import { z } from 'zod'
import { connectApplicationDomainSchema } from '../../../../../shared/schemas/application-domains'
import { ApplicationDomainService } from '../../../../services/infrastructure/application-domain-service'
import { requireIdempotencyKey } from '../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const resourceId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = connectApplicationDomainSchema.parse(await readBody(event))
  const actor = requestActor(event, session.user.id)
  const data = await new ApplicationDomainService().connect(
    resourceId,
    input,
    { ...actor, userId: session.user.id },
    requireIdempotencyKey(getHeader(event, 'idempotency-key')),
  )
  setResponseHeader(event, 'Cache-Control', 'no-store, private')
  setResponseStatus(event, data.replayed ? 200 : 202)
  return { data }
})
