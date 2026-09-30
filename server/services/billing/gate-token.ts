import { createHmac, timingSafeEqual } from 'node:crypto'

export type BillingGateTokenKind = 'notice' | 'ack'

export interface BillingGateToken {
  kind: BillingGateTokenKind
  scheme: 'http' | 'https'
  host: string
  invoiceFingerprint: string
  returnTo: string
  expiresAt: number
}

export function invoiceFingerprint(invoiceId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`invoice:${invoiceId}`)
    .digest('base64url')
    .slice(0, 24)
}

export function signBillingGateToken(payload: BillingGateToken, secret: string): string {
  if (!secret) throw new Error('Billing gate secret is not configured.')
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyBillingGateToken(
  token: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): BillingGateToken | null {
  if (!token || !secret) return null
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null

  const expected = createHmac('sha256', secret).update(encoded).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const candidate = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
    if (!isBillingGateToken(candidate) || candidate.expiresAt <= nowSeconds) return null
    return candidate
  } catch {
    return null
  }
}

function isBillingGateToken(value: unknown): value is BillingGateToken {
  if (!value || typeof value !== 'object') return false
  const token = value as Partial<BillingGateToken>
  return (
    (token.kind === 'notice' || token.kind === 'ack') &&
    (token.scheme === 'http' || token.scheme === 'https') &&
    typeof token.host === 'string' &&
    token.host.length > 0 &&
    token.host.length <= 255 &&
    typeof token.invoiceFingerprint === 'string' &&
    token.invoiceFingerprint.length > 0 &&
    typeof token.returnTo === 'string' &&
    token.returnTo.startsWith('/') &&
    typeof token.expiresAt === 'number' &&
    Number.isSafeInteger(token.expiresAt)
  )
}
