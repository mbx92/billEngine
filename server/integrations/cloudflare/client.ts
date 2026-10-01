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

  private async request(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
  ) {
    const payload = await this.rawRequest(path, options)
    return apiEnvelopeSchema(customHostnameSchema).parse(payload).result
  }

  private async rawRequest(
    path: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: Record<string, unknown> } = {},
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
