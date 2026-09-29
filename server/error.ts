import { defineNitroErrorHandler } from 'nitropack/runtime'
import { toApiError } from '#server/utils/api-error'

/**
 * Nuxt hardcodes its own Nitro error handler, so this file only takes effect
 * because `nitro.errorHandler` points at it in `nuxt.config.ts`.
 *
 * Nuxt's handler runs after ours, so an API response must be written with
 * `send()` (which marks the event as handled) — otherwise the framework handler
 * would overwrite it with a body that includes the stack trace.
 *
 * Non-API routes are delegated to Nuxt so pages keep their normal error page
 * and dev overlay.
 */
export default defineNitroErrorHandler(async (error, event, { defaultHandler }) => {
  if (!event.path?.startsWith('/api/')) {
    return defaultHandler(error, event)
  }

  const { statusCode, body } = toApiError(error)

  // Unexpected errors are logged server-side but never sent to the client.
  if (statusCode >= 500) {
    console.error('[api-error]', error)
  }

  setResponseHeaders(event, { 'content-type': 'application/json; charset=utf-8' })
  setResponseStatus(event, statusCode)

  return send(event, JSON.stringify(body))
})
