import { createApplicationResourceSchema } from '../../../../shared/schemas/infrastructure'
import {
  NativeInfrastructureService,
  requireIdempotencyKey,
} from '../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createApplicationResourceSchema.parse(await readBody(event))
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new NativeInfrastructureService().createApplication(
    input,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
