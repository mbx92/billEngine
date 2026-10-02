import { createCoolifyServerSchema } from '../../../shared/schemas/coolify'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createCoolifyServerSchema.parse(await readBody(event))

  try {
    const result = await new CoolifyResourceService().createServer(input, session.user.id)
    setResponseStatus(event, 201)
    return { data: result }
  } catch (error) {
    if (error instanceof Error && error.message === 'COOLIFY_SERVER_EXISTS') {
      throw createError({ statusCode: 409, statusMessage: 'Koneksi Coolify tersebut sudah ada.' })
    }

    if (error instanceof CoolifyClientError) {
      throw createError({ statusCode: 502, statusMessage: error.message.slice(0, 300) })
    }
    throw createError({
      statusCode: 502,
      statusMessage: 'Koneksi Coolify gagal. Periksa URL, token, dan API allowlist.',
    })
  }
})
