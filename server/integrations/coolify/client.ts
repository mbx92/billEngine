import type { ResourceMetricsStatus } from '../../../shared/types/api'
import {
  coolifyApplicationSchema,
  coolifyApplicationsSchema,
  coolifyCpuMetricsSchema,
  coolifyMemoryMetricsSchema,
  coolifyProjectsSchema,
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

export interface CoolifyCreatePublicApplicationInput {
  projectUuid: string
  serverUuid: string
  environmentName: string
  repositoryUrl: string
  branch: string
  buildPack: 'nixpacks' | 'railpack' | 'static' | 'dockerfile' | 'dockercompose'
  name: string
  description?: string
  destinationUuid?: string
  portsExposes?: string
  baseDirectory?: string
  dockerfileLocation?: string
  dockerComposeLocation?: string
  healthcheckPath?: string
  healthcheckPort?: string
  cpuCores?: string
  memoryBytes?: bigint
  customLabels?: string
  tags?: string[]
  hostname?: string
  composeServiceName?: string
}

export interface CoolifyEnvironmentVariable {
  key: string
  value: string
  isShownOnce?: boolean
}

export interface CoolifyDeployment {
  uuid: string
  status: string
  createdAt: Date | null
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

  async listApplications(tag?: string) {
    const query = tag ? `?tag=${encodeURIComponent(tag)}` : ''
    const payload = await this.request<unknown>(`/api/v1/applications${query}`)
    const parsed = coolifyApplicationsSchema.parse(payload)
    return Array.isArray(parsed) ? parsed : parsed.data
  }

  async listProjects() {
    const payload = await this.request<unknown>('/api/v1/projects')
    const parsed = coolifyProjectsSchema.parse(payload)
    return Array.isArray(parsed) ? parsed : parsed.data
  }

  async getApplication(uuid: string) {
    const payload = await this.request<unknown>(`/api/v1/applications/${encodeURIComponent(uuid)}`)
    return coolifyApplicationSchema.parse(payload)
  }

  async findApplicationByTag(tag: string) {
    const applications = await this.listApplications(tag)
    return applications[0] ?? null
  }

  async createPublicApplication(input: CoolifyCreatePublicApplicationInput) {
    const payload = await this.request<{ uuid?: unknown }>('/api/v1/applications/public', {
      method: 'POST',
      body: {
        project_uuid: input.projectUuid,
        server_uuid: input.serverUuid,
        environment_name: input.environmentName,
        git_repository: input.repositoryUrl,
        git_branch: input.branch,
        build_pack: input.buildPack,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(input.destinationUuid ? { destination_uuid: input.destinationUuid } : {}),
        ...(input.portsExposes ? { ports_exposes: input.portsExposes } : {}),
        ...(input.baseDirectory ? { base_directory: input.baseDirectory } : {}),
        ...(input.dockerfileLocation ? { dockerfile_location: input.dockerfileLocation } : {}),
        ...(input.dockerComposeLocation
          ? { docker_compose_location: input.dockerComposeLocation }
          : {}),
        ...(input.healthcheckPath
          ? {
              health_check_enabled: true,
              health_check_path: input.healthcheckPath,
              ...(input.healthcheckPort ? { health_check_port: input.healthcheckPort } : {}),
            }
          : {}),
        ...(input.cpuCores ? { limits_cpus: input.cpuCores } : {}),
        ...(input.memoryBytes ? { limits_memory: `${input.memoryBytes}b` } : {}),
        // Coolify requires custom Traefik labels as base64 (plain text → 422).
        ...(input.customLabels
          ? { custom_labels: Buffer.from(input.customLabels, 'utf8').toString('base64') }
          : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(input.hostname && input.buildPack !== 'dockercompose'
          ? { domains: `https://${input.hostname}` }
          : {}),
        ...(input.hostname && input.buildPack === 'dockercompose' && input.composeServiceName
          ? {
              docker_compose_domains: [
                { name: input.composeServiceName, domain: `https://${input.hostname}` },
              ],
            }
          : {}),
        autogenerate_domain: false,
        instant_deploy: false,
      },
    })

    if (typeof payload.uuid !== 'string' || !payload.uuid) {
      throw new CoolifyClientError('Coolify did not return an application UUID.')
    }
    return { uuid: payload.uuid }
  }

  async upsertApplicationEnvironments(uuid: string, variables: CoolifyEnvironmentVariable[]) {
    if (variables.length === 0) return
    await this.request<unknown>(`/api/v1/applications/${encodeURIComponent(uuid)}/envs/bulk`, {
      method: 'PATCH',
      body: {
        data: variables.map((variable) => ({
          key: variable.key,
          value: variable.value,
          is_preview: false,
          is_literal: true,
          is_shown_once: variable.isShownOnce ?? true,
        })),
      },
    })
  }

  async deployApplication(uuid: string) {
    const payload = await this.request<{
      deployments?: Array<{ resource_uuid?: unknown; deployment_uuid?: unknown }>
    }>(`/api/v1/deploy?uuid=${encodeURIComponent(uuid)}`, { method: 'POST' })
    const deployment = payload.deployments?.find((item) => item.resource_uuid === uuid)
    if (typeof deployment?.deployment_uuid !== 'string' || !deployment.deployment_uuid) {
      throw new CoolifyClientError('Coolify did not return a deployment UUID.')
    }
    return { uuid: deployment.deployment_uuid }
  }

  async getDeployment(uuid: string): Promise<CoolifyDeployment> {
    const payload = await this.request<Record<string, unknown>>(
      `/api/v1/deployments/${encodeURIComponent(uuid)}`,
    )
    return parseDeployment(payload)
  }

  async listApplicationDeployments(uuid: string, take = 5): Promise<CoolifyDeployment[]> {
    const payload = await this.request<unknown>(
      `/api/v1/deployments/applications/${encodeURIComponent(uuid)}?skip=0&take=${take}`,
    )
    if (!Array.isArray(payload)) return []
    return payload.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      try {
        return [parseDeployment(entry as Record<string, unknown>)]
      } catch {
        return []
      }
    })
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

  async addApplicationDomain(
    uuid: string,
    hostname: string,
    composeServiceName?: string,
    options: { instantDeploy?: boolean } = {},
  ) {
    const routing = await this.getApplicationRouting(uuid)
    const url = `https://${hostname}`
    const instantDeploy = options.instantDeploy ?? true

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
        instant_deploy: instantDeploy,
      })
      return { composeServiceName: serviceName }
    }

    await this.updateApplication(uuid, {
      domains: mergeDomainUrls(routing.fqdn, url).join(','),
      instant_deploy: instantDeploy,
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
            // Cloudflare Bot Fight Mode blocks some default/empty signatures with Error 1010.
            'user-agent': 'BillEngine/1.0 (+https://billengine.ocnetworks.web.id)',
            ...(options.body ? { 'content-type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new CoolifyClientError(
            coolifyHttpErrorMessage(response.status, body),
            response.status,
          )
        }

        const contentType = response.headers.get('content-type') ?? ''
        return (
          contentType.includes('application/json') ? await response.json() : await response.text()
        ) as T
      } catch (error) {
        if (error instanceof CoolifyClientError) throw error
        if (attempt === maxAttempts - 1) {
          throw new CoolifyClientError(coolifyNetworkErrorMessage(this.baseUrl), undefined, {
            cause: error,
          })
        }
      }
    }

    throw new CoolifyClientError(coolifyNetworkErrorMessage(this.baseUrl))
  }
}

function coolifyHttpErrorMessage(status: number, body: string) {
  const snippet = body.slice(0, 300).toLowerCase()
  if (status === 401) return 'Coolify API token ditolak. Periksa NUXT_COOLIFY_API_TOKEN.'
  if (
    status === 403 &&
    (snippet.includes('error-1010') ||
      snippet.includes('browser_signature_banned') ||
      snippet.includes('cloudflare'))
  ) {
    return 'Coolify API diblokir Cloudflare (Error 1010). Pakai URL internal host Coolify, misalnya http://host.docker.internal:8000.'
  }
  if (status === 403) return 'Coolify API menolak permintaan (HTTP 403).'
  if (status === 404) {
    const notFound = extractCoolifyMessage(body)
    return notFound
      ? `Coolify: ${notFound}`
      : 'Endpoint Coolify API tidak ditemukan (HTTP 404).'
  }
  if (status >= 500) return `Coolify API sedang error (HTTP ${status}).`

  const validation = extractCoolifyValidationSummary(body)
  if (validation) return `Coolify API menolak permintaan (HTTP ${status}): ${validation}`

  const message = extractCoolifyMessage(body)
  if (message) return `Coolify API menolak permintaan (HTTP ${status}): ${message}`

  return `Coolify API request failed (HTTP ${status}).`
}

function extractCoolifyMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return sanitizeCoolifyDetail(parsed.message)
    }
  } catch {
    // ignore non-JSON bodies
  }
  return null
}

function extractCoolifyValidationSummary(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { errors?: unknown; message?: unknown }
    if (!parsed.errors || typeof parsed.errors !== 'object' || Array.isArray(parsed.errors)) {
      return null
    }

    const parts = Object.entries(parsed.errors as Record<string, unknown>).flatMap(
      ([field, value]) => {
        const messages = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : typeof value === 'string'
            ? [value]
            : []
        return messages.map((message) => `${field}: ${sanitizeCoolifyDetail(message)}`)
      },
    )

    if (parts.length === 0) return null
    return parts.slice(0, 4).join('; ')
  } catch {
    return null
  }
}

function sanitizeCoolifyDetail(value: string) {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 180)
}

function coolifyNetworkErrorMessage(baseUrl: string) {
  const host = (() => {
    try {
      return new URL(baseUrl).host
    } catch {
      return baseUrl
    }
  })()
  return `Coolify API tidak dapat dijangkau (${host}). Jika BillEngine berjalan di host Coolify yang sama, set NUXT_COOLIFY_API_URL ke http://host.docker.internal:8000.`
}

function parseDeployment(payload: Record<string, unknown>): CoolifyDeployment {
  const uuid = payload.deployment_uuid ?? payload.uuid
  if (typeof uuid !== 'string' || !uuid) {
    throw new CoolifyClientError('Coolify deployment payload is missing its UUID.')
  }
  const createdAt = payload.created_at
  return {
    uuid,
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    createdAt:
      typeof createdAt === 'string' && !Number.isNaN(Date.parse(createdAt))
        ? new Date(createdAt)
        : null,
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

  if (Array.isArray(parsed)) {
    return Object.fromEntries(
      parsed.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const candidate = entry as Record<string, unknown>
        if (typeof candidate.name !== 'string' || !candidate.name) return []
        return [
          [
            candidate.name,
            { domain: typeof candidate.domain === 'string' ? candidate.domain : undefined },
          ],
        ]
      }),
    )
  }

  if (!parsed || typeof parsed !== 'object') return {}
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
    if (Object.keys(domains).length > 0 && !(requested in domains)) {
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
