import { deleteNodeImageSchema } from '../../../../../../shared/schemas/infrastructure'
import { InfrastructureNodeService } from '../../../../../services/infrastructure/node-service'
import { requireIdempotencyKey } from '../../../../../services/infrastructure/native-service'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const nodeId = getRouterParam(event, 'id')
  const encodedImageId = getRouterParam(event, 'imageId')
  if (!nodeId || !encodedImageId) {
    throw createError({ statusCode: 400, statusMessage: 'Node ID dan image ID wajib diisi.' })
  }
  let imageId: string
  try {
    imageId = decodeURIComponent(encodedImageId)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Image ID tidak valid.' })
  }
  const input = deleteNodeImageSchema.parse({ imageId })
  const idempotencyKey = requireIdempotencyKey(getHeader(event, 'idempotency-key'))
  const result = await new InfrastructureNodeService().deleteImage(
    nodeId,
    input.imageId,
    session.user.id,
    idempotencyKey,
  )
  setResponseStatus(event, result.replayed ? 200 : 202)
  return { data: result }
})
