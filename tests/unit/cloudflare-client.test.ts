import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CloudflareClient,
  customHostnameVerificationRecords,
} from '../../server/integrations/cloudflare/client'

describe('Cloudflare client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a DV custom hostname with a scoped bearer token', async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: {
            id: 'host-1',
            hostname: 'app.customer.test',
            status: 'pending',
            ownership_verification: { txt_name: '_cf-custom-hostname', txt_value: 'proof' },
            ssl: { status: 'pending_validation', validation_records: [] },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', request)

    const result = await new CloudflareClient(
      'cloudflare-secret',
      'zone-1',
      'https://api.cloudflare.test/client/v4',
    ).createCustomHostname('app.customer.test')

    expect(result.id).toBe('host-1')
    expect(request).toHaveBeenCalledWith(
      'https://api.cloudflare.test/client/v4/zones/zone-1/custom_hostnames',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer cloudflare-secret' }),
        body: JSON.stringify({
          hostname: 'app.customer.test',
          ssl: { method: 'http', type: 'dv' },
        }),
      }),
    )
    expect(customHostnameVerificationRecords(result)).toEqual([
      { type: 'TXT', name: '_cf-custom-hostname', value: 'proof' },
    ])
  })

  it('points platform hostnames at the wildcard tunnel CNAME target', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: [
              {
                id: 'dns-wild',
                type: 'CNAME',
                name: '*.ocnetworks.web.id',
                content: 'coolify-tunnel.cfargotunnel.com',
                proxied: true,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: [
              {
                id: 'dns-old',
                type: 'CNAME',
                name: 'digarasi.ocnetworks.web.id',
                content: 'ocn-tunnel.cfargotunnel.com',
                proxied: true,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: {
              id: 'dns-old',
              type: 'CNAME',
              name: 'digarasi.ocnetworks.web.id',
              content: 'coolify-tunnel.cfargotunnel.com',
              proxied: true,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', request)

    const client = new CloudflareClient(
      'cloudflare-secret',
      'zone-1',
      'https://api.cloudflare.test/client/v4',
    )
    const target = await client.resolveWildcardTunnelTarget('ocnetworks.web.id')
    expect(target).toBe('coolify-tunnel.cfargotunnel.com')

    const upserted = await client.upsertProxiedCname(
      'digarasi.ocnetworks.web.id',
      'coolify-tunnel.cfargotunnel.com',
    )
    expect(upserted).toMatchObject({ changed: true, content: 'coolify-tunnel.cfargotunnel.com' })
    expect(request).toHaveBeenLastCalledWith(
      'https://api.cloudflare.test/client/v4/zones/zone-1/dns_records/dns-old',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          type: 'CNAME',
          name: 'digarasi.ocnetworks.web.id',
          content: 'coolify-tunnel.cfargotunnel.com',
          proxied: true,
          ttl: 1,
        }),
      }),
    )
  })

  it('does not expose the Cloudflare response body on a transport failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ success: false, errors: [{ message: 'private provider detail' }] }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
        ),
    )

    await expect(
      new CloudflareClient(
        'bad',
        'zone',
        'https://api.cloudflare.test/client/v4',
      ).createCustomHostname('app.customer.test'),
    ).rejects.toMatchObject({ name: 'CloudflareClientError', statusCode: 403 })
  })
})
