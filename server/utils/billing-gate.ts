import { timingSafeEqual } from 'node:crypto'

export const BILLING_GATE_COOKIE = 'billing_notice_ack'

export function billingGateRuntime() {
  const config = useRuntimeConfig()
  return {
    secret: String(config.billingGateSecret || ''),
    sharedKey: String(config.billingGateSharedKey || ''),
    appUrl: String(config.public.appUrl || ''),
  }
}

export function secureStringEqual(left: string | null | undefined, right: string): boolean {
  if (!left || !right) return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
