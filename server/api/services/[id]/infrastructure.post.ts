import { uuidSchema } from '../../../../shared/schemas/common'
import { applyInfrastructureSchema } from '../../../../shared/schemas/services'
import { InfrastructureReconciliationService } from '../../../services/infrastructure/reconciliation-service'
import { requestActor } from '../../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const serviceId = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = applyInfrastructureSchema.parse(await readBody(event))
  const data = await new InfrastructureReconciliationService().apply(
    serviceId,
    input,
    requestActor(event, session.user.id),
  )

  return { data }
})
