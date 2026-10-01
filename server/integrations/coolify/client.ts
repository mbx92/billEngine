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

export interface CoolifyApplicationLimits {
  cpuCores?: string
  memoryBytes?: bigint
}

export interface CoolifyApplicationRouting {
  uuid: string
  name: string
  buildPack: string
  fqdn: string | null
  composeDomains: Record<string, { domain?: string }>
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

  async getApplicationRouting(uuid: string): Promise<CoolifyApplicationRouting> {
    const payload = await this.request<Record<string, unknown>>(
      `/api/v1/applications/${encodeURIComponent(uuid)}`,
    )

    return {
      uuid: String(payload.uuid ?? uuid),
      name: String(payload.name ?? uuid),
      buildPack: String(payload.build_pack ?? ''),
      fqdn: typeof payload.fqdn === 'string' ? payload.fqdn : null,
      composeDomains: parseComposeDomains(payload.docker_compose_domains),
    }
  }

  async addApplicationDomain(uuid: string, hostname: string, composeServiceName?: string) {
    const routing = await this.getApplicationRouting(uuid)
    const url = `https://${hostname}`

    if (routing.buildPack === 'dockercompose') {
      const serviceName = resolveComposeServiceName(routing.composeDomains, composeServiceName)
      const domains = { ...routing.composeDomains }
      domains[serviceName] = {
        ...domains[serviceName],
        domain: mergeDomainUrls(domains[serviceName]?.domain, url).join(','),
      }

      await this.updateApplication(uuid, {
        docker_compose_domains: Object.entries(domains).map(([name, value]) => ({
          name,
          ...value,
        })),
        instant_deploy: true,
      })
      return { composeServiceName: serviceName }
    }

    await this.updateApplication(uuid, {
      domains: mergeDomainUrls(routing.fqdn, url).join(','),
      instant_deploy: true,
    })
    return { composeServiceName: null }
  }

  async removeApplicationDomain(uuid: string, hostname: string, composeServiceName?: string) {
    const routing = await this.getApplicationRouting(uuid)

    if (routing.buildPack === 'dockercompose') {
      const serviceName = resolveComposeServiceName(routing.composeDomains, composeServiceName)
      const domains = { ...routing.composeDomains }
      domains[serviceName] = {
        ...domains[serviceName],
        domain: removeDomainUrl(domains[serviceName]?.domain, hostname).join(','),
      }
      await this.updateApplication(uuid, {
        docker_compose_domains: Object.entries(domains).map(([name, value]) => ({
          name,
          ...value,
        })),
        instant_deploy: true,
      })
      return
    }

    await this.updateApplication(uuid, {
      domains: removeDomainUrl(routing.fqdn, hostname).join(','),
      instant_deploy: true,
    })
  }

  async updateApplicationLimits(uuid: string, limits: CoolifyApplicationLimits) {
    const body: Record<string, string> = {}
    if (limits.cpuCores !== undefined) body.limits_cpus = limits.cpuCores
    if (limits.memoryBytes !== undefined) body.limits_memory = `${limits.memoryBytes}b`

    return this.request<unknown>(`/api/v1/applications/${encodeURIComponent(uuid)}`, {
      method: 'PATCH',
      body,
    })
  }

  private updateApplication(uuid: string, body: Record<string, unknown>) {
    return this.request<unknown>(`/api/v1/applications/${encodeURIComponent(uuid)}`, {
      method: 'PATCH',
      body,
    })
  }

  async restartApplication(uuid: string) {
    return this.request<unknown>(`/api/v1/applications/${encodeURIComponent(uuid)}/restart`, {
      method: 'POST',
    })
  }

  async startApplication(uuid: string) {
    return this.request<unknown>(`/api/v1/applications/${encodeURIComponent(uuid)}/start`, {
      method: 'POST',
    })
  }

  async stopApplication(uuid: string) {
    return this.request<unknown>(
      `/api/v1/applications/${encodeURIComponent(uuid)}/stop?docker_cleanup=false`,
      { method: 'POST' },
    )
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

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH'; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`)
    const maxAttempts = options.method === 'POST' ? 1 : 2

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: 'application/json',
            ...(options.body ? { 'content-type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
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
        if (attempt === maxAttempts - 1) {
          throw new CoolifyClientError('Coolify API request failed.', undefined, { cause: error })
        }
      }
    }

    throw new CoolifyClientError('Coolify API request failed.')
  }
}

function parseComposeDomains(value: unknown): Record<string, { domain?: string }> {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([name, entry]) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const domain = (entry as Record<string, unknown>).domain
      return [[name, { domain: typeof domain === 'string' ? domain : undefined }]]
    }),
  )
}

function resolveComposeServiceName(
  domains: Record<string, { domain?: string }>,
  requested?: string,
): string {
  if (requested) {
    if (!(requested in domains)) {
      throw new CoolifyClientError(`Compose service ${requested} tidak ditemukan.`)
    }
    return requested
  }

  const names = Object.keys(domains)
  if (names.length === 1) return names[0]!
  if (names.includes('app')) return 'app'
  throw new CoolifyClientError(
    'Aplikasi Compose memiliki beberapa service. Tentukan composeServiceName.',
  )
}

function mergeDomainUrls(current: string | null | undefined, nextUrl: string) {
  const urls = splitDomainUrls(current)
  const nextHostname = new URL(nextUrl).hostname.toLowerCase()
  if (!urls.some((url) => new URL(url).hostname.toLowerCase() === nextHostname)) urls.push(nextUrl)
  return urls
}

function removeDomainUrl(current: string | null | undefined, hostname: string) {
  const normalized = hostname.toLowerCase()
  return splitDomainUrls(current).filter(
    (url) => new URL(url).hostname.toLowerCase() !== normalized,
  )
}

function splitDomainUrls(value: string | null | undefined) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      try {
        return ['http:', 'https:'].includes(new URL(item).protocol)
      } catch {
        return false
      }
    })
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
