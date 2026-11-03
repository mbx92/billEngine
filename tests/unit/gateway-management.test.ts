import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayManagementService } from '../../server/services/billing/gateway-management-service'
import type { GatewayRepository } from '../../server/repositories/gateway'
import type { BillingAccessRepository } from '../../server/repositories/billing-access'
import type { SettingsService } from '../../server/services/settings/settings-service'
import type { CoolifyClient } from '../../server/integrations/coolify/client'
import {
  gatewayRevision,
  planGatewayLabels,
  decodeLabels,
} from '../../server/services/billing/gateway-labels'
import {
  gateProbeSignature,
  probeGateway,
  inspectGateway,
} from '../../server/services/billing/gateway-probe'
import { gatewaySettingsSchema } from '../../shared/schemas/gateway'
import { parse } from 'yaml'

const labels = [
  'traefik.enable=true',
  'traefik.http.routers.https-app.rule=Host(`app.example.test`)',
  'traefik.http.routers.https-app.middlewares=gzip,auth@file',
  'traefik.http.routers.http-app.rule=Host(`app.example.test`)',
  'traefik.http.routers.http-app.middlewares=redirect-to-https',
  'traefik.http.services.app.loadbalancer.server.port=3000',
  'custom.label=keep=this',
].join('\n')

afterEach(() => vi.unstubAllGlobals())

describe('gateway label planning', () => {
  it('preserves labels, middleware order and is idempotent for every router', () => {
    const plan = planGatewayLabels(Buffer.from(labels).toString('base64'), ['app.example.test'])
    expect(plan.labels).toContain('middlewares=gzip,auth@file,billing-gate@file')
    expect(plan.labels).toContain('middlewares=redirect-to-https,billing-gate@file')
    expect(plan.labels).toContain('custom.label=keep=this')
    expect(plan.labels).toContain('loadbalancer.server.port=3000')
    expect(planGatewayLabels(plan.labels).labels).toBe(plan.labels)
    expect(planGatewayLabels(plan.labels).configured).toBe(true)
    expect(decodeLabels(labels)).toBe(labels)
  })
  it('adds a missing middleware label without regenerating routing', () => {
    const plan = planGatewayLabels('traefik.http.routers.app.rule=Host(`app.example.test`)')
    expect(plan.labels).toContain('traefik.http.routers.app.middlewares=billing-gate@file')
  })
  it.each(['', 'caddy=example.test', `${labels}\ncustom.label=duplicate`, 'unsupported line'])(
    'rejects unsafe/absent labels',
    (value) => {
      expect(() => planGatewayLabels(value)).toThrow()
    },
  )
  it('refuses rules outside application domains including the billing app', () => {
    expect(() => planGatewayLabels(labels, ['other.example.test'])).toThrow(/domain/)
  })
  it.each([
    'file:///api/billing-gate/check',
    'https://user:pass@host/api/billing-gate/check',
    'https://host/wrong',
    'https://host/api/billing-gate/check?key=secret',
  ])('rejects invalid check URLs', (checkUrl) => {
    expect(gatewaySettingsSchema.safeParse({ checkUrl }).success).toBe(false)
  })
})

describe('gateway management workflow', () => {
  const actor = { userId: 'admin' }
  const repository = { target: vi.fn(), read: vi.fn(), serviceIds: vi.fn(), save: vi.fn() }
  const access = { findServiceByHost: vi.fn(), findOldestOpenOverdueInvoice: vi.fn() }
  const settings = { getBillingSettings: vi.fn() }
  const client = { getApplication: vi.fn(), saveApplicationGatewayLabels: vi.fn() }
  const probe = vi.fn()
  let app: Record<string, unknown>
  let service: GatewayManagementService

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('useRuntimeConfig', () => ({
      billingGateSecret: 'secret',
      billingGateSharedKey: 'key',
      public: { appUrl: 'https://billing.example.test' },
    }))
    app = {
      uuid: 'coolify-app',
      name: 'App',
      fqdn: 'https://app.example.test',
      build_pack: 'dockerfile',
      custom_labels: labels,
    }
    repository.target.mockResolvedValue({
      resource: {
        coolifyUuid: 'coolify-app',
        resourceType: 'application',
        classification: 'billable',
      },
      server: { isActive: true },
    })
    repository.serviceIds.mockResolvedValue(['service-1'])
    access.findServiceByHost.mockResolvedValue({
      id: 'service-1',
      name: 'Trial',
      serviceNumber: 'SVC-1',
      status: 'active',
    })
    access.findOldestOpenOverdueInvoice.mockResolvedValue(null)
    settings.getBillingSettings.mockResolvedValue({
      billingAccessControlEnabled: true,
      billingTimezone: 'UTC',
      graceNoticeIntervalHours: 24,
    })
    client.getApplication.mockImplementation(async () => ({ ...app }))
    client.saveApplicationGatewayLabels.mockImplementation(async (_id: string, next: string) => {
      app.custom_labels = next
    })
    service = new GatewayManagementService(
      repository as unknown as GatewayRepository,
      access as unknown as BillingAccessRepository,
      settings as unknown as SettingsService,
      () => client as unknown as CoolifyClient,
      probe,
    )
  })

  it('previews without writes, saves once, reads back, and remains pending until verified', async () => {
    const preview = await service.preview('resource')
    expect(preview.configured).toBe(false)
    expect(client.saveApplicationGatewayLabels).not.toHaveBeenCalled()
    const saved = await service.save('resource', preview.revision, actor)
    expect(saved.configured).toBe(true)
    expect(saved.verifiedAt).toBeNull()
    await service.save('resource', saved.revision, actor)
    expect(client.saveApplicationGatewayLabels).toHaveBeenCalledTimes(1)
    expect(repository.save).toHaveBeenCalledWith(
      'gateway.resource.resource',
      expect.objectContaining({ verifiedAt: null }),
      'resource',
      actor,
    )
  })
  it('rejects a stale preview before writing', async () => {
    const revision = gatewayRevision(app)
    app.custom_labels = labels + '\nnew.label=keep'
    await expect(service.save('resource', revision, actor)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(client.saveApplicationGatewayLabels).not.toHaveBeenCalled()
  })
  it('rejects an API that did not persist labels', async () => {
    client.saveApplicationGatewayLabels.mockResolvedValue(undefined)
    await expect(service.save('resource', gatewayRevision(app), actor)).rejects.toMatchObject({
      code: 'EXTERNAL_SERVICE_ERROR',
    })
    expect(repository.save).not.toHaveBeenCalled()
  })
  it.each([
    'https://billing.example.test',
    'ftp://app.example.test',
    'https://user:password@app.example.test',
  ])('rejects self-gating/unsafe domain %s', async (fqdn) => {
    app.fqdn = fqdn
    await expect(service.preview('resource')).rejects.toMatchObject({ code: 'STATE_INVALID' })
    expect(client.saveApplicationGatewayLabels).not.toHaveBeenCalled()
  })
  it('supports Compose domain verification through proxy mode without changing application labels', async () => {
    app.build_pack = 'dockercompose'
    app.fqdn = null
    app.custom_labels = null
    app.docker_compose_domains = JSON.stringify({ web: { domain: 'https://app.example.test' } })
    const preview = await service.preview('resource')
    expect(preview).toMatchObject({
      mode: 'proxy',
      changes: [],
      urls: ['https://app.example.test/'],
    })
    probe.mockResolvedValue({ verified: true, status: 418, reason: 'verified', message: 'Valid' })
    expect((await service.verify('resource', actor)).reachable).toBe(true)
    await expect(service.save('resource', preview.revision, actor)).rejects.toThrow(/Servers/)
    expect(client.saveApplicationGatewayLabels).not.toHaveBeenCalled()
  })
  it('uses the saved URL, then env internal URL, then the public app domain for YAML defaults', async () => {
    expect((await service.getSettings()).checkUrl).toBe(
      'https://billing.example.test/api/billing-gate/check',
    )
    vi.stubGlobal('useRuntimeConfig', () => ({
      billingGateSecret: 'secret',
      billingGateSharedKey: 'key',
      billingGateInternalUrl: 'http://billengine:3000/api/billing-gate/check',
      public: { appUrl: 'https://billing.example.test' },
    }))
    expect((await service.getSettings()).checkUrl).toBe(
      'http://billengine:3000/api/billing-gate/check',
    )
    repository.read.mockResolvedValue({
      checkUrl: 'https://gate.example.test/api/billing-gate/check',
    })
    const result = await service.generateYaml()
    const middleware = parse(result.yaml).http.middlewares
    expect(middleware['billing-gate-forward'].forwardAuth.address).toBe(
      'https://gate.example.test/api/billing-gate/check',
    )
    expect(middleware['billing-gate-key'].headers.customRequestHeaders['X-Billing-Gate-Key']).toBe(
      'key',
    )
    expect(result.yaml).not.toContain('<NUXT_BILLING_GATE_SHARED_KEY>')
    expect(result.yaml).not.toContain('secret')
    expect(repository.save).not.toHaveBeenCalled()
  })
  it('uses the selected node URL and quotes the actual shared key safely in YAML', async () => {
    const sharedKey = 'value: "quoted" # apostrophe\' \\ newline\nnext'
    vi.stubGlobal('useRuntimeConfig', () => ({
      billingGateSecret: 'signing-secret',
      billingGateSharedKey: sharedKey,
      public: { appUrl: 'https://billing.example.test' },
    }))
    const result = await service.generateYaml({
      checkUrl: 'http://billengine:3000/api/billing-gate/check',
    })
    const middleware = parse(result.yaml).http.middlewares
    expect(middleware['billing-gate-key'].headers.customRequestHeaders['X-Billing-Gate-Key']).toBe(
      sharedKey,
    )
    expect(middleware['billing-gate-forward'].forwardAuth.address).toBe(
      'http://billengine:3000/api/billing-gate/check',
    )
    expect(
      middleware['billing-gate-key-clear'].headers.customRequestHeaders['X-Billing-Gate-Key'],
    ).toBe('')
    expect(JSON.stringify(await service.getSettings())).not.toContain(sharedKey)
    expect(result.yaml).not.toContain('signing-secret')
    expect(repository.save).not.toHaveBeenCalled()
  })
  it('refuses YAML with missing secrets or an invalid check URL', async () => {
    await expect(
      service.generateYaml({ checkUrl: 'https://user:pass@host/wrong' }),
    ).rejects.toThrow()
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { appUrl: 'https://billing.example.test' },
    }))
    await expect(service.generateYaml()).rejects.toThrow(/NUXT_BILLING_GATE/)
  })
  it('rejects unmapped domains without changing Coolify', async () => {
    app.build_pack = 'dockerfile'
    access.findServiceByHost.mockResolvedValue(null)
    await expect(service.preview('resource')).rejects.toThrow(/hubungkan/)
    expect(client.saveApplicationGatewayLabels).not.toHaveBeenCalled()
  })
  it('reports a deployed probe separately from the gateway enabled switch', async () => {
    probe.mockResolvedValue({ verified: true, status: 418, reason: 'verified', message: 'Valid' })
    settings.getBillingSettings.mockResolvedValue({ billingAccessControlEnabled: false })
    const result = await service.verify('resource', actor)
    expect(result).toMatchObject({
      reachable: true,
      enabled: false,
      results: [{ verified: true, state: 'normal' }],
    })
    expect(repository.save).toHaveBeenCalledWith(
      'gateway.resource.resource',
      expect.objectContaining({ verifiedAt: expect.any(String) }),
      'resource',
      actor,
    )
  })
  it('does not mark a failed probe verified', async () => {
    probe.mockResolvedValue({
      verified: false,
      status: 200,
      reason: 'missing_proof',
      message: 'No proof',
    })
    expect((await service.verify('resource', actor)).reachable).toBe(false)
    expect(repository.save).toHaveBeenCalledWith(
      'gateway.resource.resource',
      expect.objectContaining({ verifiedAt: null }),
      'resource',
      actor,
    )
  })
})

describe('deployed proxy proof', () => {
  it.each([
    [200, 'missing_proof'],
    [418, 'missing_proof'],
    [302, 'redirect'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'unexpected_response'],
    [500, 'proxy_error'],
    [502, 'proxy_error'],
  ])('reports HTTP %s without trusting the body as proof', async (status, reason) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('private response content', { status: Number(status) })),
    )
    const result = await inspectGateway('https://app.example.test', 'secret')
    expect(result).toMatchObject({ verified: false, status, reason })
    expect(JSON.stringify(result)).not.toContain('private response content')
  })
  it.each([
    ['ENOTFOUND', 'dns_error'],
    ['EAI_AGAIN', 'dns_error'],
    ['CERT_HAS_EXPIRED', 'tls_error'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_error'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['ECONNREFUSED', 'connection_error'],
  ])('reports network failure %s without returning raw errors', async (code, reason) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('private error details'), { cause: { code } })),
    )
    const result = await inspectGateway('https://app.example.test', 'secret')
    expect(result).toMatchObject({ verified: false, status: null, reason })
    expect(JSON.stringify(result)).not.toContain('private error details')
  })
  it('distinguishes an invalid proof from a missing gate and rejects it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('', { status: 418, headers: { 'x-billing-gate-proof': 'invalid' } }),
        ),
    )
    expect(await inspectGateway('https://app.example.test', 'secret')).toMatchObject({
      verified: false,
      status: 418,
      reason: 'invalid_proof',
    })
  })
  it('accepts only a signature bound to the nonce and application host, never sends secrets', async () => {
    const request = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const nonce = (init.headers as Record<string, string>)['X-Billing-Gate-Probe']!
      return new Response('', {
        status: 418,
        headers: {
          'x-billing-gate-proof': gateProbeSignature(nonce, 'app.example.test', 'secret'),
        },
      })
    })
    vi.stubGlobal('fetch', request)
    expect(await probeGateway('https://app.example.test', 'secret')).toBe(true)
    expect(request).toHaveBeenCalledWith(
      'https://app.example.test',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(JSON.stringify(request.mock.calls)).not.toContain('secret')
    expect(await probeGateway('https://other.example.test', 'secret')).toBe(false)
  })
  it('rejects normal app responses and redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))
    expect(await probeGateway('https://app.example.test', 'secret')).toBe(false)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('', { status: 302, headers: { location: 'https://billing.example.test' } }),
        ),
    )
    expect(await probeGateway('https://app.example.test', 'secret')).toBe(false)
  })
})
