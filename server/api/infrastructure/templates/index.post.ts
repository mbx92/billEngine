import { createApplicationTemplateSchema } from '../../../../shared/schemas/infrastructure-templates'
import { InfrastructureTemplateService } from '../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createApplicationTemplateSchema.parse(await readBody(event))
  const template = await new InfrastructureTemplateService().createApplicationTemplate(
    input,
    session.user.id,
  )
  setResponseStatus(event, 201)
  return { data: template }
})
