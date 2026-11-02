import { z } from 'zod'

export const gatewaySettingsSchema = z.object({
  checkUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === '/api/billing-gate/check'
      )
    }, 'Gunakan URL HTTP(S) yang berakhir /api/billing-gate/check, tanpa kredensial atau query.'),
})

export const saveResourceGateSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  middlewareReady: z.literal(true),
})

export interface ApiGatewaySettings {
  checkUrl: string
  secretsConfigured: boolean
}

export interface ApiResourceGate {
  mode?: 'application' | 'proxy'
  nodeUuid?: string | null
  revision: string
  configured: boolean
  changes: Array<{ router: string; before: string; after: string }>
  urls: string[]
  verifiedAt: string | null
}

export const proxyGatewayPlanSchema = gatewaySettingsSchema.extend({
  entrypoints: z
    .array(z.string().regex(/^[a-zA-Z0-9_-]+$/))
    .max(20)
    .refine((values) => new Set(values).size === values.length),
})
export const saveProxyGatewaySchema = proxyGatewayPlanSchema.extend({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  middlewareReady: z.literal(true),
  internalRouteConfirmed: z.literal(true),
})

export interface ApiProxyGateway {
  nodeName: string
  checkUrl: string
  entrypoints: Array<{ name: string; address: string; middlewares: string; recommended: boolean }>
  selected: string[]
  savedAt: string | null
}
export interface ApiProxyGatewayPlan {
  revision: string
  changed: boolean
  changes: Array<{ entrypoint: string; before: string; after: string }>
  healthcheck: { before: string; after: string; address: string } | null
}

export interface ApiGateVerification {
  reachable: boolean
  enabled: boolean
  results: Array<{ url: string; state: string } & ApiGateProbe>
}

export interface ApiGateProbe {
  verified: boolean
  status: number | null
  reason:
    | 'verified'
    | 'missing_proof'
    | 'invalid_proof'
    | 'redirect'
    | 'unauthorized'
    | 'proxy_error'
    | 'unexpected_response'
    | 'timeout'
    | 'dns_error'
    | 'tls_error'
    | 'connection_error'
  message: string
}
