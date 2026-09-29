export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STATE_INVALID'
  | 'INTERNAL_ERROR'

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Input tidak valid.',
  AUTHENTICATION_REQUIRED: 'Authentication required.',
  FORBIDDEN: 'Admin access required.',
  NOT_FOUND: 'Data tidak ditemukan.',
  CONFLICT: 'Data sudah ada.',
  STATE_INVALID: 'Aksi tidak diizinkan pada status saat ini.',
  INTERNAL_ERROR: 'Terjadi kesalahan internal.',
}

/**
 * Domain error carries a stable machine-readable code and the HTTP status.
 * Infrastructure errors are intentionally never surfaced to the client.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly statusCode: number,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'DomainError'
  }

  static validation(message: string, details?: unknown) {
    return new DomainError('VALIDATION_ERROR', 400, message, details)
  }

  static authentication() {
    return new DomainError('AUTHENTICATION_REQUIRED', 401)
  }

  static forbidden() {
    return new DomainError('FORBIDDEN', 403)
  }

  static notFound(message?: string) {
    return new DomainError('NOT_FOUND', 404, message)
  }

  static conflict(message?: string) {
    return new DomainError('CONFLICT', 409, message)
  }

  static invalidState(message?: string) {
    return new DomainError('STATE_INVALID', 409, message)
  }
}

const API_ERROR_CODES = new Set<string>([
  'VALIDATION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STATE_INVALID',
  'INTERNAL_ERROR',
])

/**
 * Structural check for a domain error. Cross-module-graph `instanceof` is not
 * reliable inside Nitro, so the shape is validated instead.
 */
export function isDomainErrorLike(
  error: unknown,
): error is { code: ApiErrorCode; statusCode: number; message: string; details?: unknown } {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { code?: unknown; statusCode?: unknown; message?: unknown }
  return (
    typeof candidate.code === 'string' &&
    API_ERROR_CODES.has(candidate.code) &&
    typeof candidate.statusCode === 'number' &&
    typeof candidate.message === 'string'
  )
}

export function isZodErrorLike(error: unknown): error is { issues: unknown[] } {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { name?: unknown; issues?: unknown }
  return candidate.name === 'ZodError' && Array.isArray(candidate.issues)
}
