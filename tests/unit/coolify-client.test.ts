import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoolifyClient } from '../../server/integrations/coolify/client'
import type { CoolifyClientError } from '../../server/integrations/coolify/client'

describe('Coolify client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads applications from the configured Coolify API', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ uuid: 'app-1', name: 'Website' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', request)

    const applications = await new CoolifyClient(
      'https://coolify.example.test',
      'secret',
    ).listApplications()

    expect(applications).toHaveLength(1)
    expect(request).toHaveBeenCalledWith(
      new URL('https://coolify.example.test/api/v1/applications'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    )
  })

  it('reports the Coolify HTTP status without exposing its response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthenticated', { status: 401 })),
    )

    const request = new CoolifyClient('https://coolify.example.test', 'invalid').listApplications()

    await expect(request).rejects.toMatchObject<Partial<CoolifyClientError>>({
      name: 'CoolifyClientError',
      statusCode: 401,
    })
  })

  it('reads infrastructure servers managed by Coolify', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify([{ uuid: 'node-1', name: 'localhost', is_reachable: true }]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
    )

    const servers = await new CoolifyClient('https://coolify.example.test', 'secret').listServers()

    expect(servers).toMatchObject([{ uuid: 'node-1', name: 'localhost' }])
  })

  it('updates application limits using the Coolify application API', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ uuid: 'app-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', request)

    const client = new CoolifyClient('https://coolify.example.test', 'secret')
    await client.updateApplicationLimits('app-1', {
      cpuCores: '1.5',
      memoryBytes: 1_610_612_736n,
    })

    expect(request).toHaveBeenCalledWith(
      new URL('https://coolify.example.test/api/v1/applications/app-1'),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ limits_cpus: '1.5', limits_memory: '1610612736b' }),
      }),
    )
  })

  it('adds a domain to a standard application and requests an instant deploy', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uuid: 'app-1',
            name: 'Website',
            build_pack: 'dockerfile',
            fqdn: 'https://website.example.test',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uuid: 'app-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', request)

    await new CoolifyClient('https://coolify.example.test', 'secret').addApplicationDomain(
      'app-1',
      'customer.example.test',
    )

    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL('https://coolify.example.test/api/v1/applications/app-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          domains: 'https://website.example.test,https://customer.example.test',
          instant_deploy: true,
        }),
      }),
    )
  })

  it('updates Docker Compose domains without dropping existing service routes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uuid: 'app-1',
            name: 'Compose app',
            build_pack: 'dockercompose',
            docker_compose_domains: JSON.stringify({
              app: { domain: 'https://old.example.test' },
              api: { domain: 'https://api.example.test' },
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ uuid: 'app-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', request)

    const result = await new CoolifyClient(
      'https://coolify.example.test',
      'secret',
    ).addApplicationDomain('app-1', 'new.example.test', 'app')

    expect(result).toEqual({ composeServiceName: 'app' })
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual({
      docker_compose_domains: [
        { name: 'app', domain: 'https://old.example.test,https://new.example.test' },
        { name: 'api', domain: 'https://api.example.test' },
      ],
      instant_deploy: true,
    })
  })

  it('does not retry restart requests because they are not idempotent', async () => {
    const request = vi.fn().mockRejectedValue(new Error('connection reset'))
    vi.stubGlobal('fetch', request)

    const restart = new CoolifyClient('https://coolify.example.test', 'secret').restartApplication(
      'app-1',
    )

    await expect(restart).rejects.toMatchObject({ name: 'CoolifyClientError' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('starts and safely stops applications without Docker cleanup', async () => {
    const request = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'queued' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', request)
    const client = new CoolifyClient('https://coolify.example.test', 'secret')

    await client.stopApplication('app-1')
    await client.startApplication('app-1')

    expect(request).toHaveBeenNthCalledWith(
      1,
      new URL('https://coolify.example.test/api/v1/applications/app-1/stop?docker_cleanup=false'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL('https://coolify.example.test/api/v1/applications/app-1/start'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('returns disabled without contacting Sentinel when metrics are off', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)

    const usage = await new CoolifyClient(
      'https://coolify.example.test',
      'secret',
    ).getContainerUsage(
      {
        is_metrics_enabled: false,
        sentinel_custom_url: 'http://sentinel.internal:8888',
        sentinel_token: 'metrics-secret',
      },
      'app-1',
    )

    expect(usage).toMatchObject({ status: 'disabled', cpuPercent: null, memoryUsageBytes: null })
    expect(request).not.toHaveBeenCalled()
  })

  it('reads the latest CPU and memory samples from Sentinel', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ time: 1_800_000_000_000, percent: 12.5 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ time: 1_800_000_000_000, used: 134_217_728 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', request)

    const usage = await new CoolifyClient(
      'https://coolify.example.test',
      'secret',
    ).getContainerUsage(
      {
        is_metrics_enabled: true,
        sentinel_custom_url: 'http://sentinel.internal:8888',
        sentinel_token: 'metrics-secret',
      },
      'app-1',
    )

    expect(usage).toMatchObject({
      status: 'available',
      cpuPercent: 12.5,
      memoryUsageBytes: 134_217_728n,
    })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
