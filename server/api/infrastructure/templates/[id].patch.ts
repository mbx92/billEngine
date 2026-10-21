import { z } from 'zod'
import { updateApplicationTemplateSchema } from '../../../../shared/schemas/infrastructure-templates'
import { InfrastructureTemplateService } from '../../../services/infrastructure/template-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const templateId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = updateApplicationTemplateSchema.parse(await readBody(event))
  return {
    data: await new InfrastructureTemplateService().updateApplicationTemplate(
      templateId,
      input,
      session.user.id,
    ),
  }
})
