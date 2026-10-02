import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareTunnelClient } from '../../server/integrations/cloudflare/tunnel-client'
import type { CloudflareTunnelClientError } from '../../server/integrations/cloudflare/tunnel-client'

const apiBase = 'https://api.cloudflare.test/client/v4'

describe('Cloudflare Tunnel client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists active tunnels with the account-scoped endpoint', async () => {
    const request = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        errors: [],
        result: [
          {
            id: 'f70ff985-a4ef-4643-bbbc-4a0ed4fc8415',
            name: 'coolify-edge',
            status: 'healthy',
            config_src: 'cloudflare',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', request)

    const result = await new CloudflareTunnelClient('secret', 'account-1', apiBase).listTunnels()

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('coolify-edge')
    expect(request).toHaveBeenCalledWith(
      `${apiBase}/accounts/account-1/cfd_tunnel?is_deleted=false&per_page=1000`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    )
  })

  it('reads and replaces a remotely managed configuration without dropping unknown fields', async () => {
    const config = {
      ingress: [
        {
          hostname: 'app.example.test',
          service: 'https://localhost:443',
          originRequest: { noTLSVerify: true, keepAliveConnections: 100 },
        },
        { service: 'http_status:404' },
      ],
      'warp-routing': { enabled: true },
      customField: 'preserve-me',
    }
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          errors: [],
          result: { tunnel_id: 'tunnel-1', version: 1, config },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          errors: [],
          result: { tunnel_id: 'tunnel-1', version: 2, config },
        }),
      )
    vi.stubGlobal('fetch', request)
    const client = new CloudflareTunnelClient('secret', 'account-1', apiBase)

    const current = await client.getConfiguration('tunnel-1')
    expect(current.config.customField).toBe('preserve-me')
    expect(current.config.ingress[0]?.originRequest?.keepAliveConnections).toBe(100)

    await client.updateConfiguration('tunnel-1', current.config)
    expect(request).toHaveBeenLastCalledWith(
      `${apiBase}/accounts/account-1/cfd_tunnel/tunnel-1/configurations`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ config }),
      }),
    )
  })

  it('returns a sanitized client error for rejected credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, errors: [{ message: 'provider detail must stay server-side' }] },
            403,
          ),
        ),
    )

    await expect(
      new CloudflareTunnelClient('bad-secret', 'account-1', apiBase).listTunnels(),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CloudflareTunnelClientError>>({
        name: 'CloudflareTunnelClientError',
        statusCode: 403,
      }),
    )
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
