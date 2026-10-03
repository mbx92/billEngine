import { z } from 'zod'

const verificationRecordSchema = z.object({
  txt_name: z.string().optional(),
  txt_value: z.string().optional(),
  cname_name: z.string().optional(),
  cname_target: z.string().optional(),
  http_url: z.string().optional(),
  http_body: z.string().optional(),
})

const customHostnameSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    status: z.string(),
    ownership_verification: verificationRecordSchema.optional(),
    ssl: z
      .object({
        status: z.string(),
        validation_records: z.array(verificationRecordSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough()

const apiEnvelopeSchema = <T extends z.ZodType>(result: T) =>
  z.object({
    success: z.boolean(),
    errors: z
      .array(
        z.object({ code: z.number().optional(), message: z.string().optional() }).passthrough(),
      )
      .default([]),
    result,
  })

export type CloudflareCustomHostname = z.infer<typeof customHostnameSchema>

export class CloudflareClientError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CloudflareClientError'
  }
}

export class CloudflareClient {
  constructor(
    private readonly apiToken: string,
    private readonly zoneId: string,
    private readonly baseUrl = 'https://api.cloudflare.com/client/v4',
  ) {}

  createCustomHostname(hostname: string) {
    return this.request(`/zones/${encodeURIComponent(this.zoneId)}/custom_hostnames`, {
      method: 'POST',
      body: {
        hostname,
        ssl: { method: 'http', type: 'dv' },
      },
    })
  }

  getCustomHostname(id: string) {
    return this.request(
      `/zones/${encodeURIComponent(this.zoneId)}/custom_hostnames/${encodeURIComponent(id)}`,
    )
  }

  async deleteCustomHostname(id: string) {
    await this.rawRequest(
      `/zones/${encodeURIComponent(this.zoneId)}/custom_hostnames/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
  }

  /**
   * Returns the proxied CNAME target used by `*.{platformDomain}` (usually
   * `<tunnel-id>.cfargotunnel.com`). Platform app hostnames must use the same target
   * so they hit the Coolify Traefik wildcard tunnel route.
   */
  async resolveWildcardTunnelTarget(platformDomain: string): Promise<string | null> {
    const wildcard = `*.${platformDomain.trim().toLowerCase()}`
    const records = await this.listDnsRecords(wildcard)
    const cname = records.find(
      (record) => record.type === 'CNAME' && record.proxied && record.content,
    )
    return cname?.content?.replace(/\.$/, '').toLowerCase() ?? null
  }

  async upsertProxiedCname(hostname: string, target: string) {
    const name = hostname.trim().toLowerCase()
    const content = target.trim().toLowerCase().replace(/\.$/, '')
    const existing = (await this.listDnsRecords(name)).find((record) => record.type === 'CNAME')

    if (existing) {
      if (existing.content.replace(/\.$/, '').toLowerCase() === content && existing.proxied) {
        return { id: existing.id, name, content, changed: false as const }
      }
      const updated = await this.rawRequest(
        `/zones/${encodeURIComponent(this.zoneId)}/dns_records/${encodeURIComponent(existing.id)}`,
        {
          method: 'PATCH',
          body: { type: 'CNAME', name, content, proxied: true, ttl: 1 },
        },
      )
      const parsed = apiEnvelopeSchema(dnsRecordSchema).parse(updated).result
      return { id: parsed.id, name: parsed.name, content: parsed.content, changed: true as const }
    }

    const created = await this.rawRequest(
      `/zones/${encodeURIComponent(this.zoneId)}/dns_records`,
      {
        method: 'POST',
        body: { type: 'CNAME', name, content, proxied: true, ttl: 1 },
      },
    )
    const parsed = apiEnvelopeSchema(dnsRecordSchema).parse(created).result
    return { id: parsed.id, name: parsed.name, content: parsed.content, changed: true as const }
  }

  private async listDnsRecords(name: string) {
    const payload = await this.rawRequest(
      `/zones/${encodeURIComponent(this.zoneId)}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
    )
    return apiEnvelopeSchema(z.array(dnsRecordSchema)).parse(payload).result
  }

  private async request(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
  ) {
    const payload = await this.rawRequest(path, options)
    return apiEnvelopeSchema(customHostnameSchema).parse(payload).result
  }

  private async rawRequest(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: Record<string, unknown> } = {},
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
        throw new CloudflareClientError(
          payload.errors?.[0]?.message || 'Cloudflare API request failed.',
          response.status,
        )
      }
      return payload
    } catch (error) {
      if (error instanceof CloudflareClientError) throw error
      throw new CloudflareClientError('Cloudflare API request failed.', undefined, {
        cause: error,
      })
    }
  }
}

const dnsRecordSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    content: z.string(),
    proxied: z.boolean().optional().default(false),
  })
  .passthrough()

export function useCloudflareClient() {
  const config = useRuntimeConfig()
  if (!config.cloudflareApiToken || !config.cloudflareZoneId) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be configured.')
  }
  return new CloudflareClient(String(config.cloudflareApiToken), String(config.cloudflareZoneId))
}

export function customHostnameVerificationRecords(hostname: CloudflareCustomHostname) {
  const records = [hostname.ownership_verification, ...(hostname.ssl.validation_records ?? [])]
  return records.flatMap((record) => {
    if (!record) return []
    if (record.txt_name && record.txt_value) {
      return [{ type: 'TXT', name: record.txt_name, value: record.txt_value }]
    }
    if (record.cname_name && record.cname_target) {
      return [{ type: 'CNAME', name: record.cname_name, value: record.cname_target }]
    }
    if (record.http_url && record.http_body) {
      return [{ type: 'HTTP', name: record.http_url, value: record.http_body }]
    }
    return []
  })
}
