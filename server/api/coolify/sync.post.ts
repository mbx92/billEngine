import { CoolifyClientError } from '../../integrations/coolify/client'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  try {
    const result = await new CoolifyResourceService().sync(session.user.id)
    return { data: result }
  } catch (error) {
    if (error instanceof CoolifyClientError) {
      throw createError({
        statusCode: 502,
        statusMessage: error.message.slice(0, 300),
      })
    }

    throw createError({
      statusCode: 502,
      statusMessage: 'Sinkronisasi Coolify gagal. Periksa koneksi dan status server.',
    })
  }
})
