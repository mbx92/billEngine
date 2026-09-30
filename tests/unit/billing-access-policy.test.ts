import { describe, expect, it } from 'vitest'
import {
  hostsFromCoolifyFqdn,
  normalizeRequestHost,
  overdueAccessWindow,
  safeReturnPath,
} from '../../server/services/billing/access-policy'
import {
  invoiceFingerprint,
  signBillingGateToken,
  verifyBillingGateToken,
} from '../../server/services/billing/gate-token'

describe('billing access policy', () => {
  it('keeps the service usable through the configured grace window', () => {
    expect(overdueAccessWindow('2026-09-10', '2026-09-10', 7)).toBeNull()
    expect(overdueAccessWindow('2026-09-10', '2026-09-11', 7)).toMatchObject({
      state: 'grace',
      daysPastDue: 1,
      graceEndsAt: '2026-09-17',
    })
    expect(overdueAccessWindow('2026-09-10', '2026-09-17', 7)?.state).toBe('grace')
    expect(overdueAccessWindow('2026-09-10', '2026-09-18', 7)?.state).toBe('blocked')
  })

  it('blocks on the first overdue day when grace is zero', () => {
    expect(overdueAccessWindow('2026-09-10', '2026-09-11', 0)?.state).toBe('blocked')
  })

  it('normalizes forwarded hosts and Coolify domain lists exactly', () => {
    expect(normalizeRequestHost('App.Example.test:443')).toBe('app.example.test')
    expect(hostsFromCoolifyFqdn('https://app.example.test, api.example.test/path')).toEqual([
      'app.example.test',
      'api.example.test',
    ])
  })

  it('rejects unsafe return paths', () => {
    expect(safeReturnPath('/dashboard?tab=one')).toBe('/dashboard?tab=one')
    expect(safeReturnPath('//attacker.example')).toBe('/')
    expect(safeReturnPath('/ok\r\nLocation: evil')).toBe('/')
  })
})

describe('billing gate tokens', () => {
  const secret = 'a-dedicated-billing-gate-secret'

  it('round-trips signed notice tokens', () => {
    const token = signBillingGateToken(
      {
        kind: 'notice',
        scheme: 'https',
        host: 'app.example.test',
        invoiceFingerprint: invoiceFingerprint('invoice-1', secret),
        returnTo: '/dashboard',
        expiresAt: 2_000,
      },
      secret,
    )

    expect(verifyBillingGateToken(token, secret, 1_999)).toMatchObject({
      kind: 'notice',
      host: 'app.example.test',
      returnTo: '/dashboard',
    })
  })

  it('rejects expired, tampered, and wrong-secret tokens', () => {
    const token = signBillingGateToken(
      {
        kind: 'ack',
        scheme: 'http',
        host: 'app.example.test',
        invoiceFingerprint: 'fingerprint',
        returnTo: '/',
        expiresAt: 2_000,
      },
      secret,
    )

    expect(verifyBillingGateToken(token, secret, 2_001)).toBeNull()
    expect(verifyBillingGateToken(`${token}x`, secret, 1_000)).toBeNull()
    expect(verifyBillingGateToken(token, 'wrong-secret', 1_000)).toBeNull()
  })
})
