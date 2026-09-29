import { CoolifyClient, CoolifyClientError } from '../../integrations/coolify/client'
import {
  normalizeCoolifyApplication,
  normalizeCoolifyServer,
} from '../../integrations/coolify/normalize'
import type { CreateCoolifyServerInput } from '../../../shared/schemas/coolify'
import { CoolifyResourceRepository, normalizeBaseUrl } from '../../repositories/coolify-resources'
import { decryptCredential, encryptCredential } from '../../utils/credentials'

export class CoolifyResourceService {
  constructor(
    private readonly repository = new CoolifyResourceRepository(),
    private readonly client?: CoolifyClient,
  ) {}

  list(page: number, perPage: number) {
    return this.repository.list(page, perPage)
  }

  summary() {
    return this.repository.summary()
  }

  async listServers() {
    const servers = await this.repository.listServers()
    const config = useRuntimeConfig()
    const environmentUrl = config.coolifyApiUrl
      ? normalizeBaseUrl(String(config.coolifyApiUrl))
      : null

    return servers.map((server) => ({
      ...server,
      credentialSource:
        server.credentialSource === 'stored'
          ? ('stored' as const)
          : environmentUrl && normalizeBaseUrl(server.baseUrl) === environmentUrl
            ? ('environment' as const)
            : ('missing' as const),
    }))
  }

  async sync(actorUserId: string | null) {
    if (this.client) {
      const serverId = await this.repository.findOrCreateServer(this.client.getBaseUrl())
      return this.syncWithClient(serverId, this.client, actorUserId)
    }

    await this.ensureEnvironmentConnection()
    const connections = await this.repository.listActiveServerConnections()
    if (connections.length === 0) throw new Error('No active Coolify connections are configured.')

    const results = []
    for (const connection of connections) {
      const client = this.clientForConnection(connection)
      results.push(await this.syncWithClient(connection.id, client, actorUserId))
    }

    return {
      serverId: results.length === 1 ? results[0]!.serverId : 'all',
      processedCount: results.reduce((total, result) => total + result.processedCount, 0),
      nodeCount: results.reduce((total, result) => total + result.nodeCount, 0),
      syncedAt: new Date().toISOString(),
    }
  }

  async syncServer(serverId: string, actorUserId: string | null) {
    const connection = await this.repository.findServerConnection(serverId)
    if (!connection || !connection.isActive) throw new Error('COOLIFY_SERVER_NOT_FOUND')
    return this.syncWithClient(serverId, this.clientForConnection(connection), actorUserId)
  }

  async createServer(input: CreateCoolifyServerInput, actorUserId: string | null) {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const client = new CoolifyClient(baseUrl, input.apiToken)
    await client.testConnection()

    const serverId = await this.repository.createServerConnection(
      input.name,
      baseUrl,
      encryptCredential(input.apiToken),
    )

    return this.syncWithClient(serverId, client, actorUserId)
  }

  private async syncWithClient(
    serverId: string,
    client: CoolifyClient,
    actorUserId: string | null,
  ) {
    const jobId = await this.repository.startSyncJob(serverId)

    try {
      const [applications, coolifyServers] = await Promise.all([
        client.listApplications(),
        client.listServers(),
      ])
      const resources = applications.map(normalizeCoolifyApplication)
      const nodes = coolifyServers.map(normalizeCoolifyServer)
      const syncedAt = new Date()

      await this.repository.completeSync(serverId, jobId, resources, nodes, actorUserId, syncedAt)

      return {
        serverId,
        processedCount: resources.length,
        nodeCount: nodes.length,
        syncedAt: syncedAt.toISOString(),
      }
    } catch (error) {
      const message = syncErrorMessage(error)
      await this.repository.failSync(serverId, jobId, message, new Date()).catch(() => undefined)
      throw error
    }
  }

  private async ensureEnvironmentConnection() {
    const config = useRuntimeConfig()
    if (config.coolifyApiUrl && config.coolifyApiToken) {
      await this.repository.findOrCreateServer(String(config.coolifyApiUrl))
    }
  }

  private clientForConnection(connection: { baseUrl: string; tokenEncrypted: string | null }) {
    if (connection.tokenEncrypted) {
      return new CoolifyClient(connection.baseUrl, decryptCredential(connection.tokenEncrypted))
    }

    const config = useRuntimeConfig()
    if (
      config.coolifyApiUrl &&
      config.coolifyApiToken &&
      normalizeBaseUrl(String(config.coolifyApiUrl)) === normalizeBaseUrl(connection.baseUrl)
    ) {
      return new CoolifyClient(connection.baseUrl, String(config.coolifyApiToken))
    }

    throw new Error('COOLIFY_CREDENTIALS_MISSING')
  }
}

function syncErrorMessage(error: unknown) {
  if (error instanceof CoolifyClientError) {
    return error.statusCode
      ? `Coolify API request failed (HTTP ${error.statusCode}).`
      : 'Coolify API could not be reached.'
  }

  return error instanceof Error ? error.message.slice(0, 500) : 'Coolify sync failed.'
}
