import { isDomainErrorLike, isZodErrorLike, type ApiErrorCode } from './errors'

/**
 * Maps a thrown error to the documented error envelope (docs §17) and the
 * matching HTTP status.
 *
 * Detection is structural rather than `instanceof` because Nitro may load the
 * API handlers and the error handler in separate module graphs, which makes
 * class identity unreliable across that boundary.
 */
export function toApiError(error: unknown) {
  const domain = findInCauseChain(error, isDomainErrorLike)
  if (domain) {
    return {
      statusCode: domain.statusCode,
      body: {
        error: {
          code: domain.code,
          message: domain.message,
          ...(domain.details === undefined ? {} : { details: domain.details }),
        },
      },
    }
  }

  const zod = findInCauseChain(error, isZodErrorLike)
  if (zod) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR' satisfies ApiErrorCode,
          message: 'Input tidak valid.',
          details: zod.issues,
        },
      },
    }
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR' satisfies ApiErrorCode,
        message: 'Terjadi kesalahan internal.',
      },
    },
  }
}

/**
 * h3 wraps anything thrown from a handler in an `H3Error` and keeps the original
 * on `cause`, so the chain has to be walked to find the real domain error.
 */
function findInCauseChain<T>(error: unknown, predicate: (value: unknown) => value is T): T | null {
  let current: unknown = error

  for (let depth = 0; depth < 5; depth += 1) {
    if (predicate(current)) return current
    if (typeof current !== 'object' || current === null) return null
    current = (current as { cause?: unknown }).cause
  }

  return null
}
