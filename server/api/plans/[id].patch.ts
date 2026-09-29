import { updatePlanSchema } from '../../../shared/schemas/plans'
import { PlanCatalogService } from '../../services/plans/plan-catalog-service'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw DomainError.notFound('Plan tidak ditemukan.')
  const input = updatePlanSchema.parse(await readBody(event))
  const plan = await new PlanCatalogService().update(id, input)
  return { data: { id: plan.id, name: plan.name, isActive: plan.isActive } }
})
