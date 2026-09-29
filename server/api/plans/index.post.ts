import { createPlanSchema } from '../../../shared/schemas/plans'
import { PlanCatalogService } from '../../services/plans/plan-catalog-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = createPlanSchema.parse(await readBody(event))
  const plan = await new PlanCatalogService().create(input)
  setResponseStatus(event, 201)
  return { data: { id: plan.id, name: plan.name } }
})
