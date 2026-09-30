import { uuidSchema } from '../../../../shared/schemas/common'
import { InfrastructureReconciliationService } from '../../../services/infrastructure/reconciliation-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const serviceId = uuidSchema.parse(getRouterParam(event, 'id'))
  return { data: await new InfrastructureReconciliationService().preview(serviceId) }
})
