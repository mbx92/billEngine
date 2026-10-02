import { z } from 'zod'
import { CoolifyClientError } from '../../../../integrations/coolify/client'
import { CoolifyResourceService } from '../../../../services/coolify/resource-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const serverId = z.uuid().parse(getRouterParam(event, 'id'))

  try {
    const result = await new CoolifyResourceService().syncServer(serverId, session.user.id)
    return { data: result }
  } catch (error) {
    if (error instanceof Error && error.message === 'COOLIFY_SERVER_NOT_FOUND') {
      throw createError({ statusCode: 404, statusMessage: 'Koneksi Coolify tidak ditemukan.' })
    }
    if (error instanceof Error && error.message === 'COOLIFY_CREDENTIALS_MISSING') {
      throw createError({ statusCode: 409, statusMessage: 'Token koneksi Coolify belum tersedia.' })
    }

    if (error instanceof CoolifyClientError) {
      throw createError({ statusCode: 502, statusMessage: error.message.slice(0, 300) })
    }
    throw createError({ statusCode: 502, statusMessage: 'Sinkronisasi Coolify gagal.' })
  }
})
