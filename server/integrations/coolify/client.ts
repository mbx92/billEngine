import { coolifyApplicationsSchema, coolifyServersSchema } from './types'

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

export function useCoolifyClient() {
  const config = useRuntimeConfig()

  if (!config.coolifyApiUrl || !config.coolifyApiToken) {
    throw new Error('COOLIFY_API_URL and COOLIFY_API_TOKEN must be configured.')
  }

  return new CoolifyClient(config.coolifyApiUrl, config.coolifyApiToken)
}
