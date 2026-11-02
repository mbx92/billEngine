import { createServer, type Server } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAccessDecision } from '../../server/services/billing/access-control-service'
import { signBillingGateToken } from '../../server/services/billing/gate-token'
import { gateProbeSignature } from '../../server/services/billing/gateway-probe'

const { evaluate } = vi.hoisted(() => ({ evaluate: vi.fn() }))
vi.mock('../../server/services/billing/access-control-service', () => ({
  BillingAccessControlService: class {
    evaluate = evaluate
  },
}))
vi.mock('../../server/utils/billing-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/utils/billing-gate')>()),
  billingGateRuntime: () => ({
    secret: 'test-secret',
    sharedKey: 'test-key',
    appUrl: 'https://billing.example.test',
  }),
}))

describe('gateway HTTP handlers', () => {
  let server: Server
  let baseUrl: string
  const headers = {
    'x-billing-gate-key': 'test-key',
    'x-forwarded-host': 'app.example.test',
    'x-forwarded-proto': 'https',
    'x-forwarded-uri': '/dashboard',
    accept: 'text/html',
  }
  const decision: BillingAccessDecision = {
    state: 'suspended',
    service: { id: 's1', name: 'App', serviceNumber: 'SVC-1' },
    invoice: null,
    daysPastDue: 0,
    graceEndsAt: null,
    noticeIntervalHours: 24,
  }
  function token(kind: 'notice' | 'ack') {
    return signBillingGateToken(
      {
        kind,
        host: 'app.example.test',
        scheme: 'https',
        invoiceFingerprint: 'old-invoice',
        returnTo: '/dashboard',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      },
      'test-secret',
    )
  }
  beforeAll(async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    const check = (await import('../../server/api/billing-gate/check.get')).default
    const notice = (await import('../../server/api/billing-gate/notice.get')).default
    const app = createApp().use('/check', check).use('/notice', notice)
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP test port')
    baseUrl = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  beforeEach(() => evaluate.mockResolvedValue(decision))

  it('never blocks BillEngine public pages through a global entrypoint', async () => {
    const response = await fetch(`${baseUrl}/check`, {
      headers: { ...headers, 'x-forwarded-host': 'billing.example.test' },
      redirect: 'manual',
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('location')).toBeNull()
  })

  it('returns a non-success signed probe only after shared-key authentication', async () => {
    const nonce = 'a'.repeat(64)
    const response = await fetch(`${baseUrl}/check`, {
      headers: { ...headers, 'x-billing-gate-probe': nonce },
    })
    expect(response.status).toBe(418)
    expect(response.headers.get('x-billing-gate-proof')).toBe(
      gateProbeSignature(nonce, 'app.example.test', 'test-secret'),
    )
    const rejected = await fetch(`${baseUrl}/check`, {
      headers: { ...headers, 'x-billing-gate-key': 'wrong', 'x-billing-gate-probe': nonce },
    })
    expect(rejected.status).toBe(401)
    expect(rejected.headers.get('x-billing-gate-proof')).toBeNull()
  })

  it.each(['suspended', 'cancelled'])(
    'redirects %s browsers to a notice even without an invoice',
    async (state) => {
      evaluate.mockResolvedValue({ ...decision, state })
      const response = await fetch(`${baseUrl}/check`, { headers, redirect: 'manual' })
      expect(response.status).toBe(302)
      const location = new URL(response.headers.get('location')!)
      const notice = await fetch(`${baseUrl}/notice${location.search}`).then((r) => r.json())
      expect(notice.data).toMatchObject({ state, invoiceNumber: null, continueUrl: null })
    },
  )

  it('returns 403 for suspended APIs despite an old grace cookie', async () => {
    const response = await fetch(`${baseUrl}/check`, {
      headers: {
        ...headers,
        accept: 'application/json',
        cookie: `billing_notice_ack=${token('ack')}`,
      },
    })
    expect(response.status).toBe(403)
  })

  it('does not disclose a new restriction through an old notice token', async () => {
    const response = await fetch(`${baseUrl}/notice?token=${token('notice')}`)
    expect(response.ok).toBe(false)
    expect(await response.text()).not.toContain('SVC-1')
  })

  it('keeps API access and valid acknowledgements working during grace', async () => {
    evaluate.mockResolvedValue({
      ...decision,
      state: 'grace',
      invoice: {
        id: 'i1',
        invoiceNumber: 'INV-1',
        dueDate: '2026-01-01',
        fingerprint: 'old-invoice',
      },
    })
    const api = await fetch(`${baseUrl}/check`, {
      headers: { ...headers, accept: 'application/json' },
    })
    expect(api.status).toBe(204)
    const browser = await fetch(`${baseUrl}/check`, {
      headers: { ...headers, cookie: `billing_notice_ack=${token('ack')}` },
    })
    expect(browser.status).toBe(204)
  })

  it('does not allow a continuation token to bypass suspension', async () => {
    const response = await fetch(`${baseUrl}/check`, {
      headers: { ...headers, 'x-forwarded-uri': `/.billing/continue?token=${token('notice')}` },
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/billing/overdue?token=')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns 402 after grace and allows access after payment', async () => {
    evaluate
      .mockResolvedValueOnce({
        ...decision,
        state: 'blocked',
        invoice: {
          id: 'i1',
          invoiceNumber: 'INV-1',
          dueDate: '2026-01-01',
          fingerprint: 'invoice',
        },
      })
      .mockResolvedValueOnce({ ...decision, state: 'normal' })
    expect(
      (await fetch(`${baseUrl}/check`, { headers: { ...headers, accept: 'application/json' } }))
        .status,
    ).toBe(402)
    expect((await fetch(`${baseUrl}/check`, { headers })).status).toBe(204)
  })
})
