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
})
