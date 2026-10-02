import { z } from 'zod'

const originRequestSchema = z
  .object({
    noTLSVerify: z.boolean().optional(),
    httpHostHeader: z.string().optional(),
    originServerName: z.string().optional(),
  })
  .passthrough()

const ingressRuleSchema = z
  .object({
    hostname: z.string().optional(),
    path: z.string().optional(),
    service: z.string(),
    originRequest: originRequestSchema.optional(),
  })
  .passthrough()

const tunnelConfigSchema = z
  .object({
    ingress: z.array(ingressRuleSchema).default([]),
    originRequest: originRequestSchema.optional(),
    'warp-routing': z.object({ enabled: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough()

const tunnelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['inactive', 'degraded', 'healthy', 'down']).catch('inactive'),
    config_src: z.enum(['local', 'cloudflare']).optional(),
    remote_config: z.boolean().optional(),
    created_at: z.string().optional(),
    conns_active_at: z.string().nullable().optional(),
    conns_inactive_at: z.string().nullable().optional(),
  })
  .passthrough()

const configurationSchema = z
  .object({
    account_id: z.string().optional(),
    tunnel_id: z.string().optional(),
    version: z.number().optional(),
    created_at: z.string().optional(),
    source: z.string().optional(),
    config: tunnelConfigSchema.default({ ingress: [] }),
  })
  .passthrough()

const responseInfoSchema = z.object({ code: z.number().optional(), message: z.string().optional() })

const envelopeSchema = <T extends z.ZodType>(result: T) =>
  z.object({
    success: z.boolean(),
    errors: z.array(responseInfoSchema.passthrough()).default([]),
    result,
  })

export type CloudflareTunnel = z.infer<typeof tunnelSchema>
export type CloudflareTunnelConfig = z.infer<typeof tunnelConfigSchema>
export type CloudflareTunnelConfiguration = z.infer<typeof configurationSchema>
export type CloudflareTunnelIngressRule = z.infer<typeof ingressRuleSchema>

export class CloudflareTunnelClientError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CloudflareTunnelClientError'
  }
}

export class CloudflareTunnelClient {
  constructor(
    private readonly apiToken: string,
    private readonly accountId: string,
    private readonly baseUrl = 'https://api.cloudflare.com/client/v4',
  ) {}

  async listTunnels() {
    const payload = await this.request(
      `/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel?is_deleted=false&per_page=1000`,
    )
    return envelopeSchema(z.array(tunnelSchema)).parse(payload).result
  }

  async getTunnel(tunnelId: string) {
    const payload = await this.request(
      `/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`,
    )
    return envelopeSchema(tunnelSchema).parse(payload).result
  }

  async getConfiguration(tunnelId: string) {
    const payload = await this.request(
      `/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
    )
    return envelopeSchema(configurationSchema).parse(payload).result
  }

  async updateConfiguration(tunnelId: string, config: CloudflareTunnelConfig) {
    const payload = await this.request(
      `/accounts/${encodeURIComponent(this.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
      { method: 'PUT', body: { config } },
    )
    return envelopeSchema(configurationSchema).parse(payload).result
  }

  private async request(
    path: string,
    options: { method?: 'GET' | 'PUT'; body?: Record<string, unknown> } = {},
  ): Promise<unknown> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      })
      const payload = (await response.json()) as {
        success?: boolean
        errors?: Array<{ message?: string }>
      }
      if (!response.ok || payload.success === false) {
        throw new CloudflareTunnelClientError(
          payload.errors?.[0]?.message || 'Cloudflare Tunnel API request failed.',
          response.status,
        )
      }
      return payload
    } catch (error) {
      if (error instanceof CloudflareTunnelClientError) throw error
      throw new CloudflareTunnelClientError('Cloudflare Tunnel API request failed.', undefined, {
        cause: error,
      })
    }
  }
}

export function useCloudflareTunnelClient() {
  const config = useRuntimeConfig()
  if (!config.cloudflareApiToken || !config.cloudflareAccountId) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be configured.')
  }
  return new CloudflareTunnelClient(
    String(config.cloudflareApiToken),
    String(config.cloudflareAccountId),
  )
}
