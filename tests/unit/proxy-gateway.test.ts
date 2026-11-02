import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  inspectProxyConfiguration,
  planProxyGateway,
  validateInternalGateUrl,
} from '../../server/services/billing/proxy-gateway-config'
import { ProxyGatewayService } from '../../server/services/billing/proxy-gateway-service'
import type { GatewayRepository } from '../../server/repositories/gateway'
import { type CoolifyClient, CoolifyClientError } from '../../server/integrations/coolify/client'

const configuration = `# preserve this deployment
services:
  traefik:
    image: traefik:v3.6
    container_name: coolify-proxy
    ports:
      - '80:80'
      - '443:443'
      - '8443:443/tcp'
    environment:
      KEEP_SECRET: '\${KEEP_SECRET}'
    volumes:
      - /data/coolify/proxy:/traefik
    command:
      - --entrypoints.http.address=:80
      - --entrypoints.https.address=:443
      - --entrypoints.https.http.middlewares=existing@file,compress@docker
      - --entrypoints.traefik.address=:8080
      - --entrypoints.dns.address=:53/udp
      - --providers.file.directory=/traefik/dynamic/
      - --providers.docker=true
networks:
  coolify:
    external: true
`
const internalUrl = 'http://host.docker.internal:8010/api/billing-gate/check'
const coolifyConfiguration = configuration.replace(
  '    command:',
  `    healthcheck:
      test: 'wget -qO- http://localhost:80/ping || exit 1'
      interval: 4s
      timeout: 2s
      retries: 5
    command:
      - --ping=true
      - --ping.entrypoint=http`,
)
afterEach(() => vi.unstubAllGlobals())

describe('proxy entrypoint planner', () => {
  it('isolates the default Coolify ping and Docker healthcheck before gating HTTP', () => {
    const plan = planProxyGateway(coolifyConfiguration, ['http', 'https'])
    const proxy = parse(plan.configuration).services.traefik
    expect(proxy.command).toContain('--ping.entrypoint=billengine-health')
    expect(proxy.command).toContain('--entrypoints.billengine-health.address=127.0.0.1:9082')
    expect(proxy.healthcheck).toEqual({
      test: 'wget -qO- http://127.0.0.1:9082/ping || exit 1',
      interval: '4s',
      timeout: '2s',
      retries: 5,
    })
    expect(proxy.ports).toEqual(parse(coolifyConfiguration).services.traefik.ports)
    expect(plan.healthcheck?.before).toContain('localhost:80/ping')
    expect(inspectProxyConfiguration(plan.configuration).entrypoints.map((e) => e.name)).toEqual([
      'http',
      'https',
    ])
    expect(planProxyGateway(plan.configuration, ['http', 'https']).changed).toBe(false)
    // Gate removal leaves the independent, working healthcheck in place.
    const rollback = planProxyGateway(plan.configuration, [])
    expect(rollback.configuration).not.toContain('billing-gate@file')
    expect(parse(rollback.configuration).services.traefik.healthcheck).toEqual(proxy.healthcheck)
  })
  it('repairs an already gated HTTP entrypoint even when middleware flags are unchanged', () => {
    const broken = coolifyConfiguration.replace(
      '--entrypoints.http.address=:80',
      '--entrypoints.http.address=:80\n      - --entrypoints.http.http.middlewares=billing-gate@file',
    )
    const plan = planProxyGateway(broken, ['http'])
    expect(plan.changed).toBe(true)
    expect(plan.changes.every((change) => change.before === change.after)).toBe(true)
    expect(plan.healthcheck).not.toBeNull()
  })
  it('does not relocate ping when only HTTPS is gated', () => {
    expect(planProxyGateway(coolifyConfiguration, ['https']).healthcheck).toBeNull()
  })
  it('supports CMD-SHELL healthchecks and avoids occupied listener ports', () => {
    const input = coolifyConfiguration
      .replace(
        "test: 'wget -qO- http://localhost:80/ping || exit 1'",
        "test: [CMD-SHELL, 'wget -qO- http://localhost:80/ping || exit 1']",
      )
      .replace(
        '--providers.docker=true',
        '--providers.docker=true\n      - --entrypoints.metrics.address=:9082',
      )
    const plan = planProxyGateway(input, ['http'])
    expect(plan.healthcheck?.address).toBe('127.0.0.1:9083')
    expect(parse(plan.configuration).services.traefik.healthcheck.test).toEqual([
      'CMD-SHELL',
      'wget -qO- http://127.0.0.1:9083/ping || exit 1',
    ])
  })
  it.each([
    coolifyConfiguration.replace('wget -qO-', 'curl -f'),
    coolifyConfiguration.replace('--ping=true', '--ping.manualrouting=true'),
    coolifyConfiguration.replace('--ping=true', '--ping=false'),
    coolifyConfiguration.replace(
      '--providers.docker=true',
      '--entrypoints.billengine-health.address=:9082',
    ),
  ])('rejects unsafe healthcheck rewrites but permits removing the gate', (input) => {
    expect(() => planProxyGateway(input, ['http'])).toThrow()
    expect(() => planProxyGateway(input, [])).not.toThrow()
  })
  it('changes only middleware flags, preserving routes, ports, environment, mounts and comments', () => {
    const plan = planProxyGateway(configuration, ['http', 'https'])
    const before = parse(configuration)
    const after = parse(plan.configuration)
    expect(plan.changed).toBe(true)
    expect(after.services.traefik.command).toContain(
      '--entrypoints.https.http.middlewares=existing@file,compress@docker,billing-gate@file',
    )
    expect(after.services.traefik.command).toContain(
      '--entrypoints.http.http.middlewares=billing-gate@file',
    )
    expect(plan.configuration).toContain('# preserve this deployment')
    delete before.services.traefik.command
    delete after.services.traefik.command
    expect(after).toEqual(before)
    const again = planProxyGateway(plan.configuration, ['https', 'http'])
    expect(again.changed).toBe(false)
    expect(again.configuration).toBe(plan.configuration)
    expect(
      inspectProxyConfiguration(configuration).entrypoints.map((entrypoint) => entrypoint.name),
    ).toEqual(['http', 'https'])
  })
  it('removes only the gate reference for rollback', () => {
    const enabled = planProxyGateway(configuration, ['http', 'https'])
    const disabled = planProxyGateway(enabled.configuration, [])
    expect(parse(disabled.configuration)).toEqual(parse(configuration))
    expect(disabled.configuration).not.toContain('billing-gate@file')
  })
  it('supports a middleware change on only the selected entrypoint', () => {
    const plan = planProxyGateway(configuration, ['https'])
    expect(plan.changes.find((change) => change.entrypoint === 'http')).toMatchObject({
      before: '',
      after: '',
    })
    expect(() => planProxyGateway(configuration, ['unknown'])).toThrow(/Entrypoint/)
  })
  it.each([
    configuration.replace('image: traefik:v3.6', 'image: caddy:2'),
    configuration.replace(
      '--providers.file.directory=/traefik/dynamic/',
      '--configFile=/config/traefik.yml',
    ),
    configuration.replace('KEEP_SECRET:', 'TRAEFIK_ENTRYPOINTS_HTTP_ADDRESS:'),
    configuration.replace('--providers.docker=true', '--entrypoints.https.address=:8443'),
    configuration.replace('external: true', 'external: [bad'),
    configuration.replace(
      'KEEP_SECRET:',
      'KEEP_SECRET: &secret x\n      ALIAS: *secret\n      KEY:',
    ),
  ])('rejects ambiguous or unsupported static configuration without changing it', (value) => {
    expect(() => planProxyGateway(value, ['https'])).toThrow()
  })
  it.each([
    'https://billing.example.test/api/billing-gate/check',
    'http://localhost:8010/api/billing-gate/check',
    'http://127.0.0.1:8010/api/billing-gate/check',
    'http://coolify-proxy:8010/api/billing-gate/check',
    'http://10.1.0.3:443/api/billing-gate/check',
    'http://10.1.0.3:8443/api/billing-gate/check',
    'http://host.docker.internal/api/billing-gate/check',
    'http://169.254.169.254:8010/api/billing-gate/check',
    'http://10.1.0.3:8010/api/billing-gate/check?key=secret',
  ])('rejects public/loopback/proxy-port URLs: %s', (url) => {
    expect(() =>
      validateInternalGateUrl(url, configuration, 'https://billing.example.test'),
    ).toThrow()
  })
  it.each([
    internalUrl,
    'http://billengine:3000/api/billing-gate/check',
    'http://10.1.0.3:8010/api/billing-gate/check',
  ])('accepts direct internal URLs: %s', (url) => {
    expect(() =>
      validateInternalGateUrl(url, configuration, 'https://billing.example.test'),
    ).not.toThrow()
  })
})

describe('proxy gateway service', () => {
  const repository = { nodeTarget: vi.fn(), read: vi.fn(), save: vi.fn() }
  const client = { getServerProxy: vi.fn(), saveServerProxyConfiguration: vi.fn() }
  let service: ProxyGatewayService
  let current = configuration
  const input = { checkUrl: internalUrl, entrypoints: ['http', 'https'] }
  const actor = { userId: 'admin' }

  beforeEach(() => {
    vi.resetAllMocks()
    current = configuration
    vi.stubGlobal('useRuntimeConfig', () => ({
      billingGateSecret: 'secret',
      billingGateSharedKey: 'key',
      public: { appUrl: 'https://billing.example.test' },
    }))
    repository.nodeTarget.mockResolvedValue({
      node: { name: 'App Node', coolifyUuid: 'remote-node-uuid' },
      server: { isActive: true },
    })
    client.getServerProxy.mockImplementation(async () => ({
      proxy_type: 'TRAEFIK',
      configuration: current,
    }))
    client.saveServerProxyConfiguration.mockImplementation(async (_uuid: string, value: string) => {
      current = value
    })
    service = new ProxyGatewayService(
      repository as unknown as GatewayRepository,
      () => client as unknown as CoolifyClient,
      async () => ({ checkUrl: internalUrl, secretsConfigured: true }),
    )
  })
  it('uses the actual node UUID and saves only after a current preview, without leaking configuration', async () => {
    const view = await service.get('db-node-id')
    expect(view.selected).toEqual(['http', 'https'])
    expect(JSON.stringify(view)).not.toContain('KEEP_SECRET')
    const preview = await service.preview('db-node-id', input)
    expect(client.saveServerProxyConfiguration).not.toHaveBeenCalled()
    const result = await service.save('db-node-id', { ...input, revision: preview.revision }, actor)
    expect(result.restartRequired).toBe(true)
    expect(client.saveServerProxyConfiguration).toHaveBeenCalledWith(
      'remote-node-uuid',
      expect.stringContaining('billing-gate@file'),
    )
    expect(JSON.stringify(repository.save.mock.calls)).not.toContain('KEEP_SECRET')
    const unchanged = await service.preview('db-node-id', input)
    await service.save('db-node-id', { ...input, revision: unchanged.revision }, actor)
    expect(client.saveServerProxyConfiguration).toHaveBeenCalledTimes(1)
  })
  it('rejects both stale configuration and altered selection/check URL', async () => {
    const preview = await service.preview('db-node-id', input)
    await expect(
      service.save(
        'db-node-id',
        { ...input, entrypoints: ['http'], revision: preview.revision },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      service.save(
        'db-node-id',
        { ...input, checkUrl: internalUrl.replace('8010', '8011'), revision: preview.revision },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    current += '\n# changed in Coolify\n'
    await expect(
      service.save('db-node-id', { ...input, revision: preview.revision }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(client.saveServerProxyConfiguration).not.toHaveBeenCalled()
  })
  it('fails clearly for unsupported APIs, missing sensitive permission and missing saved configuration', async () => {
    client.getServerProxy.mockRejectedValueOnce(new CoolifyClientError('404', 404))
    await expect(service.get('node')).rejects.toThrow(/Endpoint/)
    client.getServerProxy.mockResolvedValueOnce({ proxy_type: 'TRAEFIK' })
    await expect(service.get('node')).rejects.toThrow(/read:sensitive/)
    client.getServerProxy.mockResolvedValueOnce({ proxy_type: 'TRAEFIK', configuration: null })
    await expect(service.get('node')).rejects.toThrow(/belum tersimpan/)
    expect(client.saveServerProxyConfiguration).not.toHaveBeenCalled()
  })
  it('rejects readback mismatch instead of reporting a successful save', async () => {
    const preview = await service.preview('node', input)
    client.saveServerProxyConfiguration.mockResolvedValue(undefined)
    await expect(
      service.save('node', { ...input, revision: preview.revision }, actor),
    ).rejects.toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR' })
    expect(repository.save).not.toHaveBeenCalled()
  })
  it('can remove gate flags even when the previous internal URL no longer passes loop checks', async () => {
    current = planProxyGateway(configuration, input.entrypoints).configuration
    const rollback = {
      entrypoints: [],
      checkUrl: 'https://billing.example.test/api/billing-gate/check',
    }
    const preview = await service.preview('node', rollback)
    await service.save('node', { ...rollback, revision: preview.revision }, actor)
    expect(parse(current)).toEqual(parse(configuration))
  })
})
