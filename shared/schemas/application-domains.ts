import { z } from 'zod'
import { cloudflareTunnelRouteSchema } from './cloudflare-tunnels'

export const connectApplicationDomainSchema = z
  .object({
    hostname: cloudflareTunnelRouteSchema.shape.hostname
      .max(253)
      .refine(
        (value) => !value.startsWith('*.'),
        'Gunakan domain khusus aplikasi, bukan wildcard.',
      ),
    tunnelId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    targetPort: z.number().int().min(1).max(65535),
    origin: z
      .string()
      .trim()
      .max(2048)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value)
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            url.pathname === '/'
          )
        } catch {
          return false
        }
      }, 'Gunakan origin HTTP/HTTPS tanpa kredensial atau path, misalnya http://oc-gateway:80.'),
  })
  .refine(
    (input) => {
      try {
        return new URL(input.origin).hostname.toLowerCase() !== input.hostname
      } catch {
        return true
      }
    },
    {
      path: ['origin'],
      message:
        'Origin tidak boleh menggunakan domain publik yang sedang dihubungkan karena akan membuat loop.',
    },
  )
export type ConnectApplicationDomainInput = z.infer<typeof connectApplicationDomainSchema>
