import type { H3Event } from 'h3'

/**
 * Collects the caller identity needed for the audit trail. Tokens and other
 * secrets are never included (docs §14).
 */
export function requestActor(event: H3Event, userId: string | null) {
  const headers = getRequestHeaders(event)

  return {
    userId,
    ipAddress: headers['cf-connecting-ip'] ?? headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? null,
    userAgent: headers['user-agent'] ?? null,
  }
}
