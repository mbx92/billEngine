import { z } from 'zod'
import { CoolifyResourceService } from '../../../../services/coolify/resource-service'
import { CoolifyClientError } from '../../../../integrations/coolify/client'
import { DomainError } from '../../../../utils/errors'

const inputSchema = z.object({
  apiToken: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !/^Bearer\s/i.test(value), 'Masukkan token saja, tanpa awalan Bearer.'),
})
export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = inputSchema.parse(await readBody(event))
  try {
    return {
      data: await new CoolifyResourceService().replaceServerToken(
        id,
        input.apiToken,
        session.user.id,
      ),
    }
  } catch (error) {
    if (error instanceof CoolifyClientError) throw DomainError.external(error.message.slice(0, 300))
    if (error instanceof Error && error.message === 'COOLIFY_SERVER_NOT_FOUND')
      throw DomainError.notFound('Koneksi Coolify tidak ditemukan.')
    throw error
  }
})
