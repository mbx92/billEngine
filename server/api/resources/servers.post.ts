import { createCoolifyServerSchema } from '../../../shared/schemas/coolify'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { CoolifyResourceService } from '../../services/coolify/resource-service'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createCoolifyServerSchema.parse(await readBody(event))

  try {
    const result = await new CoolifyResourceService().createServer(input, session.user.id)
    setResponseStatus(event, 201)
    return { data: result }
  } catch (error) {
    if (error instanceof Error && error.message === 'COOLIFY_SERVER_EXISTS') {
      throw DomainError.conflict('Koneksi Coolify tersebut sudah ada.')
    }

    if (error instanceof CoolifyClientError) {
      throw DomainError.external(error.message.slice(0, 300))
    }
    // Preserve database/configuration causes for the central error handler.
    throw error
  }
})
