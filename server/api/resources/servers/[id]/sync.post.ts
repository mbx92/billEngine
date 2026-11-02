import { z } from 'zod'
import { CoolifyClientError } from '../../../../integrations/coolify/client'
import { CoolifyResourceService } from '../../../../services/coolify/resource-service'
import { DomainError } from '../../../../utils/errors'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const serverId = z.uuid().parse(getRouterParam(event, 'id'))

  try {
    const result = await new CoolifyResourceService().syncServer(serverId, session.user.id)
    return { data: result }
  } catch (error) {
    if (error instanceof Error && error.message === 'COOLIFY_SERVER_NOT_FOUND') {
      throw DomainError.notFound('Koneksi Coolify tidak ditemukan.')
    }
    if (error instanceof Error && error.message === 'COOLIFY_CREDENTIALS_MISSING') {
      throw DomainError.invalidState('Token koneksi Coolify belum tersedia.')
    }

    if (error instanceof CoolifyClientError) {
      throw DomainError.external(error.message.slice(0, 300))
    }
    throw error
  }
})
