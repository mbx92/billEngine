const transientCodes = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006',
])

/** Drizzle and h3 wrap pg errors; inspect causes without relying on class identity. */
export function isTransientDatabaseError(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== 'object') return false
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof candidate.code === 'string' && transientCodes.has(candidate.code)) return true
    if (
      typeof candidate.message === 'string' &&
      /connection terminated|connection ended unexpectedly|timeout exceeded when trying to connect/i.test(
        candidate.message,
      )
    )
      return true
    current = candidate.cause
  }
  return false
}
