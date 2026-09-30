import { and, asc, count, eq, ilike, inArray, ne, notInArray, or, sql, sum } from 'drizzle-orm'
import type { ResourceListQuery } from '../../shared/schemas/coolify'
import type {
  ApiResourceListItem,
  ApiResourceServer,
  ApiResourceServiceLink,
  ApiResourceSummary,
} from '../../shared/types/api'
import type {
  NormalizedCoolifyNode,
  NormalizedCoolifyResource,
} from '../integrations/coolify/normalize'
import { useDatabase, type Database, type Transaction } from '../database/client'
import {
  auditLogs,
  coolifyNodes,
  coolifyResources,
  coolifyServers,
  customers,
  jobRuns,
  serviceResources,
  services,
} from '../database/schema'

/**
 * A resource counts as not billed when no active service is linked to it.
 * Built as raw SQL so it stays independent of any database instance.
 */
const notBilledCondition = sql`not exists (
  select 1
  from ${serviceResources}
  inner join ${services} on ${services.id} = ${serviceResources.serviceId}
  where ${serviceResources.resourceId} = ${coolifyResources.id}
    and ${services.status} = 'active'
)`

type QueryExecutor = Database | Transaction

export class CoolifyResourceRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async list(input: ResourceListQuery) {
    const { page, perPage, q, status, classification, assignment } = input
    const offset = (page - 1) * perPage
    const filters = [eq(coolifyServers.isActive, true)]

    if (q) {
      const query = `%${q}%`
      filters.push(
        or(
          ilike(coolifyResources.name, query),
          ilike(coolifyResources.coolifyUuid, query),
          ilike(coolifyResources.projectName, query),
          ilike(coolifyResources.environmentName, query),
          ilike(coolifyResources.fqdn, query),
          ilike(coolifyServers.name, query),
        )!,
      )
    }
    if (status) filters.push(eq(coolifyResources.status, status))
    if (classification) filters.push(eq(coolifyResources.classification, classification))
    if (assignment === 'assigned') filters.push(sql`not (${notBilledCondition})`)
    if (assignment === 'unassigned') filters.push(notBilledCondition)
    if (assignment === 'not_billed') {
      filters.push(eq(coolifyResources.classification, 'billable'), notBilledCondition)
    }
    const where = and(...filters)

    const [rows, totals] = await Promise.all([
      this.database
        .select({
          id: coolifyResources.id,
          name: coolifyResources.name,
          coolifyUuid: coolifyResources.coolifyUuid,
          resourceType: coolifyResources.resourceType,
          status: coolifyResources.status,
          classification: coolifyResources.classification,
          fqdn: coolifyResources.fqdn,
          projectName: coolifyResources.projectName,
          environmentName: coolifyResources.environmentName,
          nodeName: coolifyNodes.name,
          limitsCpus: coolifyResources.limitsCpus,
          limitsMemoryBytes: coolifyResources.limitsMemoryBytes,
          lastSeenAt: coolifyResources.lastSeenAt,
          serverId: coolifyServers.id,
          serverName: coolifyServers.name,
        })
        .from(coolifyResources)
        .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
        .leftJoin(
          coolifyNodes,
          and(
            eq(coolifyNodes.coolifyServerId, coolifyResources.coolifyServerId),
            eq(coolifyNodes.coolifyUuid, coolifyResources.coolifyNodeUuid),
          ),
        )
        .where(where)
        .orderBy(asc(coolifyResources.name))
        .limit(perPage)
        .offset(offset),
      this.database
        .select({ total: count() })
        .from(coolifyResources)
        .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
        .where(where),
    ])

    const linkedServices = await this.findServiceLinks(rows.map((row) => row.id))

    return {
      rows: rows.map<ApiResourceListItem>((row) => ({
        id: row.id,
        name: row.name,
        coolifyUuid: row.coolifyUuid,
        resourceType: row.resourceType,
        status: row.status,
        classification: row.classification,
        fqdn: row.fqdn,
        projectName: row.projectName,
        environmentName: row.environmentName,
        nodeName: row.nodeName,
        serverId: row.serverId,
        serverName: row.serverName,
        limitsCpus: row.limitsCpus,
        limitsMemoryBytes: row.limitsMemoryBytes?.toString() ?? null,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        services: linkedServices.get(row.id) ?? [],
      })),
      total: totals[0]?.total ?? 0,
    }
  }

  async findByIdsForUpdate(transaction: Transaction, ids: string[]) {
    if (ids.length === 0) return []

    return transaction
      .select({
        id: coolifyResources.id,
        name: coolifyResources.name,
        classification: coolifyResources.classification,
      })
      .from(coolifyResources)
      .where(inArray(coolifyResources.id, ids))
      .orderBy(asc(coolifyResources.id))
      .for('update')
  }

  async updateClassification(
    transaction: QueryExecutor,
    ids: string[],
    classification: 'billable' | 'internal' | 'ignored',
  ) {
    if (ids.length === 0) return []

    return transaction
      .update(coolifyResources)
      .set({ classification, updatedAt: new Date() })
      .where(inArray(coolifyResources.id, ids))
      .returning({
        id: coolifyResources.id,
        name: coolifyResources.name,
        classification: coolifyResources.classification,
      })
  }

  async metricsTargets(resourceIds: string[]) {
    if (resourceIds.length === 0) return []

    return this.database
      .select({
        resourceId: coolifyResources.id,
        coolifyUuid: coolifyResources.coolifyUuid,
        resourceType: coolifyResources.resourceType,
        rawMetadata: coolifyResources.rawMetadata,
        coolifyNodeUuid: coolifyResources.coolifyNodeUuid,
        coolifyServerId: coolifyServers.id,
        baseUrl: coolifyServers.baseUrl,
        tokenEncrypted: coolifyServers.tokenEncrypted,
      })
      .from(coolifyResources)
      .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
      .where(and(inArray(coolifyResources.id, resourceIds), eq(coolifyServers.isActive, true)))
  }

  async summary(): Promise<ApiResourceSummary> {
    const [totals, lastSync] = await Promise.all([
      this.database
        .select({
          total: count(),
          running:
            sql<number>`count(*) filter (where ${coolifyResources.status} = 'running')`.mapWith(
              Number,
            ),
          stopped:
            sql<number>`count(*) filter (where ${coolifyResources.status} = 'stopped')`.mapWith(
              Number,
            ),
          degraded:
            sql<number>`count(*) filter (where ${coolifyResources.status} = 'degraded')`.mapWith(
              Number,
            ),
          unknown:
            sql<number>`count(*) filter (where ${coolifyResources.status} = 'unknown')`.mapWith(
              Number,
            ),
          billable:
            sql<number>`count(*) filter (where ${coolifyResources.classification} = 'billable')`.mapWith(
              Number,
            ),
          internal:
            sql<number>`count(*) filter (where ${coolifyResources.classification} = 'internal')`.mapWith(
              Number,
            ),
          ignored:
            sql<number>`count(*) filter (where ${coolifyResources.classification} = 'ignored')`.mapWith(
              Number,
            ),
          notBilled:
            sql<number>`count(*) filter (where ${coolifyResources.classification} = 'billable' and ${notBilledCondition})`.mapWith(
              Number,
            ),
          totalCpuCores: sum(coolifyResources.limitsCpus),
          totalMemoryBytes: sum(coolifyResources.limitsMemoryBytes),
        })
        .from(coolifyResources)
        .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
        .where(eq(coolifyServers.isActive, true)),
      this.database
        .select({ lastSyncedAt: coolifyServers.lastSyncedAt })
        .from(coolifyServers)
        .where(eq(coolifyServers.isActive, true))
        .orderBy(sql`${coolifyServers.lastSyncedAt} desc nulls last`)
        .limit(1),
    ])

    const row = totals[0]

    return {
      total: row?.total ?? 0,
      running: row?.running ?? 0,
      stopped: row?.stopped ?? 0,
      degraded: row?.degraded ?? 0,
      unknown: row?.unknown ?? 0,
      billable: row?.billable ?? 0,
      internal: row?.internal ?? 0,
      ignored: row?.ignored ?? 0,
      notBilled: row?.notBilled ?? 0,
      totalCpuCores: row?.totalCpuCores ?? null,
      totalMemoryBytes: row?.totalMemoryBytes?.toString() ?? null,
      lastSyncedAt: lastSync[0]?.lastSyncedAt?.toISOString() ?? null,
    }
  }

  async listServers(): Promise<ApiResourceServer[]> {
    const [rows, nodeRows] = await Promise.all([
      this.database
        .select({
          id: coolifyServers.id,
          name: coolifyServers.name,
          baseUrl: coolifyServers.baseUrl,
          status: coolifyServers.status,
          isActive: coolifyServers.isActive,
          tokenEncrypted: coolifyServers.tokenEncrypted,
          lastSyncedAt: coolifyServers.lastSyncedAt,
          lastSyncStatus: coolifyServers.lastSyncStatus,
          lastSyncError: coolifyServers.lastSyncError,
          resourceCount: count(coolifyResources.id),
        })
        .from(coolifyServers)
        .leftJoin(coolifyResources, eq(coolifyResources.coolifyServerId, coolifyServers.id))
        .where(eq(coolifyServers.isActive, true))
        .groupBy(coolifyServers.id)
        .orderBy(asc(coolifyServers.name)),
      this.database
        .select({
          id: coolifyNodes.id,
          coolifyServerId: coolifyNodes.coolifyServerId,
          coolifyUuid: coolifyNodes.coolifyUuid,
          name: coolifyNodes.name,
          address: coolifyNodes.address,
          sshPort: coolifyNodes.sshPort,
          status: coolifyNodes.status,
          isReachable: coolifyNodes.isReachable,
          isUsable: coolifyNodes.isUsable,
          isCoolifyHost: coolifyNodes.isCoolifyHost,
          lastSeenAt: coolifyNodes.lastSeenAt,
          resourceCount: count(coolifyResources.id),
        })
        .from(coolifyNodes)
        .leftJoin(
          coolifyResources,
          and(
            eq(coolifyResources.coolifyServerId, coolifyNodes.coolifyServerId),
            eq(coolifyResources.coolifyNodeUuid, coolifyNodes.coolifyUuid),
          ),
        )
        .groupBy(coolifyNodes.id)
        .orderBy(asc(coolifyNodes.name)),
    ])

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      status: row.status,
      isActive: row.isActive,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncError: row.lastSyncError,
      resourceCount: Number(row.resourceCount),
      credentialSource: row.tokenEncrypted ? 'stored' : 'missing',
      nodes: nodeRows
        .filter((node) => node.coolifyServerId === row.id)
        .map((node) => ({
          id: node.id,
          coolifyUuid: node.coolifyUuid,
          name: node.name,
          address: node.address,
          sshPort: node.sshPort,
          status: node.status,
          isReachable: node.isReachable,
          isUsable: node.isUsable,
          isCoolifyHost: node.isCoolifyHost,
          resourceCount: Number(node.resourceCount),
          lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
        })),
    }))
  }

  async listActiveServerConnections() {
    return this.database
      .select({
        id: coolifyServers.id,
        name: coolifyServers.name,
        baseUrl: coolifyServers.baseUrl,
        tokenEncrypted: coolifyServers.tokenEncrypted,
      })
      .from(coolifyServers)
      .where(eq(coolifyServers.isActive, true))
      .orderBy(asc(coolifyServers.name))
  }

  async findServerConnection(id: string) {
    const rows = await this.database
      .select({
        id: coolifyServers.id,
        name: coolifyServers.name,
        baseUrl: coolifyServers.baseUrl,
        tokenEncrypted: coolifyServers.tokenEncrypted,
        isActive: coolifyServers.isActive,
      })
      .from(coolifyServers)
      .where(eq(coolifyServers.id, id))
      .limit(1)

    return rows[0] ?? null
  }

  async createServerConnection(name: string, baseUrl: string, tokenEncrypted: string) {
    const configuredUrl = normalizeBaseUrl(baseUrl)
    const existing = (await this.listActiveServerConnections()).find(
      (server) => normalizeBaseUrl(server.baseUrl) === configuredUrl,
    )
    if (existing) throw new Error('COOLIFY_SERVER_EXISTS')

    const inserted = await this.database
      .insert(coolifyServers)
      .values({ name, baseUrl: configuredUrl, tokenEncrypted, isActive: true })
      .returning({ id: coolifyServers.id })

    const server = inserted[0]
    if (!server) throw new Error('Failed to create Coolify connection.')
    return server.id
  }

  async findOrCreateServer(baseUrl: string) {
    const servers = await this.database
      .select({ id: coolifyServers.id, baseUrl: coolifyServers.baseUrl })
      .from(coolifyServers)

    const configuredUrl = normalizeBaseUrl(baseUrl)
    const existing = servers.find((server) => normalizeBaseUrl(server.baseUrl) === configuredUrl)
    if (existing) {
      await this.database
        .update(coolifyServers)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(coolifyServers.id, existing.id))
      return existing.id
    }

    const hostname = new URL(configuredUrl).hostname
    const inserted = await this.database
      .insert(coolifyServers)
      .values({
        name: `Coolify (${hostname})`,
        baseUrl: configuredUrl,
        status: 'unknown',
        isActive: true,
      })
      .returning({ id: coolifyServers.id })

    const server = inserted[0]
    if (!server) throw new Error('Failed to create the configured Coolify server.')
    return server.id
  }

  async startSyncJob(serverId: string) {
    const inserted = await this.database
      .insert(jobRuns)
      .values({ jobName: 'coolify.resources.sync', metadata: { serverId } })
      .returning({ id: jobRuns.id })

    const job = inserted[0]
    if (!job) throw new Error('Failed to start the Coolify sync job.')
    return job.id
  }

  async completeSync(
    serverId: string,
    jobId: string,
    resources: NormalizedCoolifyResource[],
    nodes: NormalizedCoolifyNode[],
    actorUserId: string | null,
    syncedAt: Date,
  ) {
    const seenUuids = resources.map((resource) => resource.coolifyUuid)
    const seenNodeUuids = nodes.map((node) => node.coolifyUuid)

    await this.database.transaction(async (transaction) => {
      for (const node of nodes) {
        await transaction
          .insert(coolifyNodes)
          .values({
            coolifyServerId: serverId,
            ...node,
            lastSeenAt: syncedAt,
            lastSyncedAt: syncedAt,
            updatedAt: syncedAt,
          })
          .onConflictDoUpdate({
            target: [coolifyNodes.coolifyServerId, coolifyNodes.coolifyUuid],
            set: {
              name: node.name,
              address: node.address,
              sshPort: node.sshPort,
              status: node.status,
              isReachable: node.isReachable,
              isUsable: node.isUsable,
              isCoolifyHost: node.isCoolifyHost,
              rawMetadata: node.rawMetadata,
              lastSeenAt: syncedAt,
              lastSyncedAt: syncedAt,
              updatedAt: syncedAt,
            },
          })
      }

      const missingNodeCondition =
        seenNodeUuids.length > 0
          ? and(
              eq(coolifyNodes.coolifyServerId, serverId),
              notInArray(coolifyNodes.coolifyUuid, seenNodeUuids),
            )
          : eq(coolifyNodes.coolifyServerId, serverId)

      await transaction
        .update(coolifyNodes)
        .set({
          status: 'unknown',
          isReachable: false,
          isUsable: false,
          lastSyncedAt: syncedAt,
          updatedAt: syncedAt,
        })
        .where(missingNodeCondition)

      for (const resource of resources) {
        await transaction
          .insert(coolifyResources)
          .values({
            coolifyServerId: serverId,
            ...resource,
            lastSeenAt: syncedAt,
            lastSyncedAt: syncedAt,
            updatedAt: syncedAt,
          })
          .onConflictDoUpdate({
            target: [coolifyResources.coolifyServerId, coolifyResources.coolifyUuid],
            set: {
              resourceType: resource.resourceType,
              name: resource.name,
              status: resource.status,
              fqdn: resource.fqdn,
              projectName: resource.projectName,
              environmentName: resource.environmentName,
              coolifyNodeUuid: resource.coolifyNodeUuid,
              limitsCpus: resource.limitsCpus,
              limitsCpuset: resource.limitsCpuset,
              limitsCpuShares: resource.limitsCpuShares,
              limitsMemoryBytes: resource.limitsMemoryBytes,
              memoryReservationBytes: resource.memoryReservationBytes,
              memorySwapBytes: resource.memorySwapBytes,
              rawMetadata: resource.rawMetadata,
              lastSeenAt: syncedAt,
              lastSyncedAt: syncedAt,
              updatedAt: syncedAt,
            },
          })
      }

      const missingCondition =
        seenUuids.length > 0
          ? and(
              eq(coolifyResources.coolifyServerId, serverId),
              notInArray(coolifyResources.coolifyUuid, seenUuids),
            )
          : eq(coolifyResources.coolifyServerId, serverId)

      await transaction
        .update(coolifyResources)
        .set({ status: 'unknown', lastSyncedAt: syncedAt, updatedAt: syncedAt })
        .where(missingCondition)

      await transaction
        .update(coolifyServers)
        .set({
          status: 'connected',
          lastSyncedAt: syncedAt,
          lastSyncStatus: 'completed',
          lastSyncError: null,
          updatedAt: syncedAt,
        })
        .where(eq(coolifyServers.id, serverId))

      await transaction
        .update(jobRuns)
        .set({
          status: 'completed',
          finishedAt: syncedAt,
          processedCount: resources.length,
          errorMessage: null,
        })
        .where(eq(jobRuns.id, jobId))

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'coolify.resources.sync',
        entityType: 'coolify_server',
        entityId: serverId,
        metadata: { processedCount: resources.length, nodeCount: nodes.length },
      })
    })
  }

  async failSync(serverId: string, jobId: string, errorMessage: string, failedAt: Date) {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(coolifyServers)
        .set({
          status: 'error',
          lastSyncStatus: 'failed',
          lastSyncError: errorMessage,
          updatedAt: failedAt,
        })
        .where(eq(coolifyServers.id, serverId))

      await transaction
        .update(jobRuns)
        .set({ status: 'failed', finishedAt: failedAt, errorMessage })
        .where(eq(jobRuns.id, jobId))
    })
  }

  private async findServiceLinks(resourceIds: string[]) {
    const links = new Map<string, ApiResourceServiceLink[]>()
    if (resourceIds.length === 0) return links

    const rows = await this.database
      .select({
        resourceId: serviceResources.resourceId,
        serviceId: services.id,
        serviceNumber: services.serviceNumber,
        name: services.name,
        customerName: customers.name,
        planName: services.planName,
      })
      .from(serviceResources)
      .innerJoin(services, eq(services.id, serviceResources.serviceId))
      .innerJoin(customers, eq(customers.id, services.customerId))
      .where(
        and(inArray(serviceResources.resourceId, resourceIds), ne(services.status, 'cancelled')),
      )

    for (const row of rows) {
      const existing = links.get(row.resourceId) ?? []
      existing.push({
        id: row.serviceId,
        serviceNumber: row.serviceNumber,
        name: row.name,
        customerName: row.customerName,
        planName: row.planName,
      })
      links.set(row.resourceId, existing)
    }

    return links
  }
}

export function normalizeBaseUrl(value: string) {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}
