import { CoolifyClientError } from '../../integrations/coolify/client'
import { CoolifyResourceService } from '../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)

  try {
    const result = await new CoolifyResourceService().sync(session.user.id)
    return { data: result }
  } catch (error) {
    const statusMessage =
      error instanceof CoolifyClientError && error.statusCode === 401
        ? 'Token Coolify ditolak. Periksa COOLIFY_API_TOKEN.'
        : 'Sinkronisasi Coolify gagal. Periksa koneksi dan status server.'

    throw createError({ statusCode: 502, statusMessage })
  }
})
