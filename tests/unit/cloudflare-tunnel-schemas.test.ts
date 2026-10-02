import { describe, expect, it } from 'vitest'
import { createCloudflareTunnelRouteSchema } from '../../shared/schemas/cloudflare-tunnels'

describe('Cloudflare Tunnel schemas', () => {
  it('normalizes a valid wildcard route', () => {
    expect(
      createCloudflareTunnelRouteSchema.parse({
        hostname: '*.Example.Test',
        path: '',
        service: 'https://localhost:443',
        noTlsVerify: true,
      }),
    ).toMatchObject({
      hostname: '*.example.test',
      service: 'https://localhost:443',
      noTlsVerify: true,
    })
  })

  it.each(['localhost:3000', 'file:///etc/passwd', 'http_status:999'])(
    'rejects unsafe origin service %s',
    (service) => {
      expect(() =>
        createCloudflareTunnelRouteSchema.parse({
          hostname: 'app.example.test',
          service,
        }),
      ).toThrow()
    },
  )
})
