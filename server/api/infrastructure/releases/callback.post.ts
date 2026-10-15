import { createHash, timingSafeEqual } from 'node:crypto'
import { releaseCallbackSchema } from '../../../../shared/schemas/releases'
import { InfrastructureReleaseService } from '../../../services/infrastructure/release-service'

export default defineEventHandler(async (event) => {
  const configuredSecret = String(useRuntimeConfig(event).releaseWebhookSecret || '')
  const authorization = getHeader(event, 'authorization') ?? ''
  const suppliedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!configuredSecret || !safeEqual(configuredSecret, suppliedSecret)) {
    throw createError({ statusCode: 401, statusMessage: 'Release callback authentication failed.' })
  }

  const input = releaseCallbackSchema.parse(await readBody(event))
  const result = await new InfrastructureReleaseService().receiveRelease(input)
  setResponseStatus(event, 202)
  return { data: result }
})

function safeEqual(expected: string, actual: string) {
  const expectedHash = createHash('sha256').update(expected).digest()
  const actualHash = createHash('sha256').update(actual).digest()
  return timingSafeEqual(expectedHash, actualHash)
}
