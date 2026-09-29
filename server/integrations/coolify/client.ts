import type { ResourceMetricsStatus } from '../../../shared/types/api'
import {
  coolifyApplicationsSchema,
  coolifyCpuMetricsSchema,
  coolifyMemoryMetricsSchema,
  coolifySentinelSettingsSchema,
  coolifyServersSchema,
  type CoolifySentinelSettings,
} from './types'

export interface CoolifyContainerUsage {
  status: ResourceMetricsStatus
  cpuPercent: number | null
  memoryUsageBytes: bigint | null
  sampledAt: Date | null
}

export class CoolifyClientError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CoolifyClientError'
  }
}

export class CoolifyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  getBaseUrl() {
    return this.baseUrl
  }

  async testConnection(): Promise<boolean> {
    await this.request<unknown>('/api/v1/version')
    return true
  }

  async listApplications() {
    const payload = await this.request<unknown>('/api/v1/applications')
    const parsed = coolifyApplicationsSchema.parse(payload)
    return Array.isArray(parsed) ? parsed : parsed.data
  }

  async listServers() {
    const payload = await this.request<unknown>('/api/v1/servers')
    const parsed = coolifyServersSchema.parse(payload)
    return Array.isArray(parsed) ? parsed : parsed.data
  }

  async getSentinelSettings(serverUuid: string) {
    const payload = await this.request<unknown>(
      `/api/v1/servers/${encodeURIComponent(serverUuid)}/sentinel`,
    )
    return coolifySentinelSettingsSchema.parse(payload)
  }

  async getContainerUsage(
    settings: CoolifySentinelSettings,
    resourceUuid: string,
  ): Promise<CoolifyContainerUsage> {
    if (!settings.is_metrics_enabled) return emptyUsage('disabled')
    if (!settings.sentinel_custom_url || !settings.sentinel_token) {
      return emptyUsage('unreachable')
    }

    const sentinelUrl = new URL(settings.sentinel_custom_url)
    if (!['http:', 'https:'].includes(sentinelUrl.protocol)) {
      return emptyUsage('unreachable')
    }

    const from = new Date(Date.now() - 10 * 60_000).toISOString()
    const encodedUuid = encodeURIComponent(resourceUuid)
    const encodedFrom = encodeURIComponent(from)

    try {
      const [cpuPayload, memoryPayload] = await Promise.all([
        this.sentinelRequest(
          settings,
          `/api/container/${encodedUuid}/cpu/history?from=${encodedFrom}`,
        ),
        this.sentinelRequest(
          settings,
          `/api/container/${encodedUuid}/memory/history?from=${encodedFrom}`,
        ),
      ])
      const cpuMetrics = coolifyCpuMetricsSchema.parse(cpuPayload)
      const memoryMetrics = coolifyMemoryMetricsSchema.parse(memoryPayload)
      const cpu = cpuMetrics.at(-1)
      const memory = memoryMetrics.at(-1)

      if (!cpu && !memory) return emptyUsage('no_data')

      const sampledAt = Math.max(cpu?.time ?? 0, memory?.time ?? 0)
      return {
        status: 'available',
        cpuPercent: cpu?.percent ?? null,
        memoryUsageBytes: memory ? BigInt(Math.round(memory.used)) : null,
        sampledAt: sampledAt ? metricTimeToDate(sampledAt) : null,
      }
    } catch {
      return emptyUsage('unreachable')
    }
  }

  private async sentinelRequest(settings: CoolifySentinelSettings, path: string): Promise<unknown> {
    const url = new URL(path, ensureTrailingSlash(settings.sentinel_custom_url!))
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${settings.sentinel_token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok)
      throw new CoolifyClientError('Sentinel metrics request failed.', response.status)
    return response.json()
  }

  private async request<T>(path: string): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        })

        if (!response.ok) {
          throw new CoolifyClientError('Coolify API request failed.', response.status)
        }

        const contentType = response.headers.get('content-type') ?? ''
        return (
          contentType.includes('application/json') ? await response.json() : await response.text()
        ) as T
      } catch (error) {
        if (error instanceof CoolifyClientError) throw error
        if (attempt === 1) {
          throw new CoolifyClientError('Coolify API request failed.', undefined, { cause: error })
        }
      }
    }

    throw new CoolifyClientError('Coolify API request failed.')
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function emptyUsage(status: Exclude<ResourceMetricsStatus, 'available'>): CoolifyContainerUsage {
  return { status, cpuPercent: null, memoryUsageBytes: null, sampledAt: null }
}

function metricTimeToDate(value: number): Date {
  return new Date(value < 1_000_000_000_000 ? value * 1_000 : value)
}

export function useCoolifyClient() {
  const config = useRuntimeConfig()

  if (!config.coolifyApiUrl || !config.coolifyApiToken) {
    throw new Error('COOLIFY_API_URL and COOLIFY_API_TOKEN must be configured.')
  }

  return new CoolifyClient(config.coolifyApiUrl, config.coolifyApiToken)
}
