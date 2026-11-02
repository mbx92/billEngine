import { CoolifyClientError } from '../../integrations/coolify/client'
import { CoolifyResourceService } from '../../services/coolify/resource-service'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  try {
    const result = await new CoolifyResourceService().sync(session.user.id)
    return { data: result }
  } catch (error) {
    if (error instanceof CoolifyClientError) {
      throw DomainError.external(error.message.slice(0, 300))
    }

    throw error
  }
})
