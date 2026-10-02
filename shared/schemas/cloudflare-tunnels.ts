import { z } from 'zod'
import { uuidSchema } from './common'

const hostnamePattern = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const servicePattern =
  /^(?:(?:https?|unix|tcp|ssh|rdp|unix\+tls|smb):\/\/\S+|http_status:[1-5]\d{2})$/i

const optionalText = (max: number) => z.string().trim().max(max)

export const cloudflareTunnelIdSchema = uuidSchema

export const cloudflareTunnelRouteKeySchema = z.object({
  hostname: z.string().trim().toLowerCase().regex(hostnamePattern, 'Hostname tidak valid.'),
  path: optionalText(512).default(''),
})

export const cloudflareTunnelRouteSchema = cloudflareTunnelRouteKeySchema.extend({
  service: z.string().trim().min(1).max(2048).regex(servicePattern, 'Origin service tidak valid.'),
  noTlsVerify: z.boolean().default(false),
  httpHostHeader: optionalText(255).default(''),
  originServerName: optionalText(255).default(''),
})

export const createCloudflareTunnelRouteSchema = cloudflareTunnelRouteSchema

export const updateCloudflareTunnelRouteSchema = z.object({
  original: cloudflareTunnelRouteKeySchema,
  route: cloudflareTunnelRouteSchema,
})

export const deleteCloudflareTunnelRouteSchema = cloudflareTunnelRouteKeySchema

export type CloudflareTunnelRouteInput = z.infer<typeof cloudflareTunnelRouteSchema>
export type CloudflareTunnelRouteKey = z.infer<typeof cloudflareTunnelRouteKeySchema>
