import { InfrastructureTemplateService } from '../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new InfrastructureTemplateService().listTemplates() }
})
