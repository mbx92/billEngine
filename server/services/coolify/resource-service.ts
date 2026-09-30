import { CoolifyClient, CoolifyClientError } from '../../integrations/coolify/client'
import {
  normalizeCoolifyApplication,
  normalizeCoolifyServer,
} from '../../integrations/coolify/normalize'
import type {
  BulkUpdateResourceClassificationInput,
  CreateCoolifyServerInput,
  ResourceListQuery,
  UpdateResourceClassificationInput,
} from '../../../shared/schemas/coolify'
import { CoolifyResourceRepository, normalizeBaseUrl } from '../../repositories/coolify-resources'
import { AuditLogRepository } from '../../repositories/audit'
import { encryptCredential } from '../../utils/credentials'
import type { ApiResourceUsageMetric } from '../../../shared/types/api'
import { useDatabase, type Database } from '../../database/client'
import { DomainError } from '../../utils/errors'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'

interface ResourceActorContext {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export class CoolifyResourceService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly repository = new CoolifyResourceRepository(database),
    private readonly audit = new AuditLogRepository(database),
    private readonly client?: CoolifyClient,
  ) {}

  list(input: ResourceListQuery) {
    return this.repository.list(input)
  }

  summary() {
    return this.repository.summary()
  }

  updateClassification(
    resourceId: string,
    input: UpdateResourceClassificationInput,
    actor: ResourceActorContext,
  ) {
    return this.updateClassifications(
      { resourceIds: [resourceId], classification: input.classification },
      actor,
    ).then((result) => result.resources[0]!)
  }

  async updateClassifications(
    input: BulkUpdateResourceClassificationInput,
    actor: ResourceActorContext,
  ) {
    return this.database.transaction(async (transaction) => {
      const rows = await this.repository.findByIdsForUpdate(transaction, input.resourceIds)
      if (rows.length !== input.resourceIds.length) {
        throw DomainError.notFound('Satu atau lebih resource tidak ditemukan.')
      }

      const changedRows = rows.filter((row) => row.classification !== input.classification)
      const updatedResources = await this.repository.updateClassification(
        transaction,
        changedRows.map((row) => row.id),
        input.classification,
      )

      for (const row of changedRows) {
        await this.audit.record(transaction, {
          actorUserId: actor.userId,
          action: 'resource.classification.updated',
          entityType: 'coolify_resource',
          entityId: row.id,
          beforeData: { classification: row.classification },
          afterData: { classification: input.classification },
          metadata: { resourceName: row.name },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })
      }

      return {
        resources: rows.map((row) => ({ ...row, classification: input.classification })),
        updatedCount: updatedResources.length,
      }
    })
  }

  async usageMetrics(resourceIds: string[]): Promise<ApiResourceUsageMetric[]> {
    const targets = await this.repository.metricsTargets(resourceIds)
    const contexts = new Map<
      string,
      { client: CoolifyClient; settings: ReturnType<CoolifyClient['getSentinelSettings']> }
    >()

    return Promise.all(
      targets.map(async (target): Promise<ApiResourceUsageMetric> => {
        const metadata = target.rawMetadata as Record<string, unknown> | null
        if (metadata?.build_pack === 'dockercompose') {
          return emptyApiMetric(target.resourceId, 'unsupported')
        }
        if (!target.coolifyNodeUuid) {
          return emptyApiMetric(target.resourceId, 'unreachable')
        }

        const contextKey = `${target.coolifyServerId}:${target.coolifyNodeUuid}`
        let context = contexts.get(contextKey)
        if (!context) {
          const client = this.clientForConnection(target)
          context = {
            client,
            settings: client.getSentinelSettings(target.coolifyNodeUuid),
          }
          contexts.set(contextKey, context)
        }

        try {
          const settings = await context.settings
          const usage = await context.client.getContainerUsage(settings, target.coolifyUuid)
          return {
            resourceId: target.resourceId,
            status: usage.status,
            cpuPercent: usage.cpuPercent,
            memoryUsageBytes: usage.memoryUsageBytes?.toString() ?? null,
            sampledAt: usage.sampledAt?.toISOString() ?? null,
          }
        } catch {
          return emptyApiMetric(target.resourceId, 'unreachable')
        }
      }),
    )
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
    return clientForCoolifyConnection(connection)
  }
}

function emptyApiMetric(
  resourceId: string,
  status: Exclude<ApiResourceUsageMetric['status'], 'available'>,
): ApiResourceUsageMetric {
  return {
    resourceId,
    status,
    cpuPercent: null,
    memoryUsageBytes: null,
    sampledAt: null,
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
