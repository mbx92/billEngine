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
