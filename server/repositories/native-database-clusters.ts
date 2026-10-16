import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { CreateNativeDatabaseClusterInput } from '../../shared/schemas/native-database-clusters'
import type { ProvisionNativeServiceDatabaseInput } from '../../shared/schemas/native-service-databases'
import { useDatabase, type Database } from '../database/client'
import {
  auditLogs,
  customers,
  infrastructureBackupTargets,
  infrastructureDatabaseClusters,
  infrastructureDatabaseBackups,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  infrastructureServiceDatabases,
  infrastructureTemplates,
  services,
} from '../database/schema'

export interface ActivateNativeDatabaseClusterRecord {
  clusterId: string
  operationId: string
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
  input: CreateNativeDatabaseClusterInput
}

export interface ProvisionNativeServiceDatabaseRecord {
  clusterId: string
  allocationId: string
  operationId: string
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
  databaseName: string
  roleName: string
  passwordEncrypted: string
  connectionUriEncrypted: string
  networkAlias: string
  input: ProvisionNativeServiceDatabaseInput
}

export interface ReprovisionNativeServiceDatabaseRecord {
  allocationId: string
  operationId: string
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
  mode: 'retry' | 'rotate'
  passwordEncrypted?: string
  connectionUriEncrypted?: string
}

export interface CreateDatabaseBackupRecord {
  backupId: string
  allocationId: string
  operationId: string
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
  policyId?: string
  storageTargetId?: string
  objectKey?: string
  objectStorage?: {
    provider: 's3'
    endpoint: string
    region: string
    bucket: string
    objectKey: string
    pathStyle: boolean
  }
}

export interface RestoreDatabaseBackupRecord {
  backupId: string
  operationId: string
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
}

export class NativeDatabaseClusterRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findClusterConnectionTarget(clusterId: string) {
    const [cluster] = await this.database
      .select({ primaryResourceId: infrastructureDatabaseClusters.primaryResourceId })
      .from(infrastructureDatabaseClusters)
      .where(eq(infrastructureDatabaseClusters.id, clusterId))
      .limit(1)
    return cluster ?? null
  }

  async findServiceDatabaseContext(allocationId: string) {
    const [allocation] = await this.database
      .select({
        id: infrastructureServiceDatabases.id,
        status: infrastructureServiceDatabases.status,
        databaseName: infrastructureServiceDatabases.databaseName,
        roleName: infrastructureServiceDatabases.roleName,
        primaryResourceId: infrastructureDatabaseClusters.primaryResourceId,
      })
      .from(infrastructureServiceDatabases)
      .innerJoin(
        infrastructureDatabaseClusters,
        eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId),
      )
      .where(
        and(
          eq(infrastructureServiceDatabases.id, allocationId),
          isNull(infrastructureServiceDatabases.deletedAt),
        ),
      )
      .limit(1)
    return allocation ?? null
  }

  async overview() {
    const [clusters, candidates, allocations, eligibleServices, eligibleApplications, backups] =
      await Promise.all([
        this.database
          .select({
            id: infrastructureDatabaseClusters.id,
            name: infrastructureDatabaseClusters.name,
            engine: infrastructureDatabaseClusters.engine,
            mode: infrastructureDatabaseClusters.mode,
            status: infrastructureDatabaseClusters.status,
            isActive: infrastructureDatabaseClusters.isActive,
            adminDatabase: infrastructureDatabaseClusters.adminDatabase,
            provisionerUsername: infrastructureDatabaseClusters.provisionerUsername,
            defaultConnectionLimit: infrastructureDatabaseClusters.defaultConnectionLimit,
            lastError: infrastructureDatabaseClusters.lastError,
            activatedAt: infrastructureDatabaseClusters.activatedAt,
            createdAt: infrastructureDatabaseClusters.createdAt,
            updatedAt: infrastructureDatabaseClusters.updatedAt,
            primaryResourceId: infrastructureResources.id,
            primaryResourceName: infrastructureResources.name,
            resourceState: infrastructureResources.observedState,
            nodeId: infrastructureNodes.id,
            nodeName: infrastructureNodes.name,
            nodeStatus: infrastructureNodes.status,
            agentVersion: infrastructureNodes.agentVersion,
          })
          .from(infrastructureDatabaseClusters)
          .innerJoin(
            infrastructureResources,
            eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId),
          )
          .innerJoin(
            infrastructureNodes,
            eq(infrastructureNodes.id, infrastructureResources.nodeId),
          )
          .orderBy(asc(infrastructureDatabaseClusters.name)),
        this.database
          .select({
            id: infrastructureResources.id,
            name: infrastructureResources.name,
            observedState: infrastructureResources.observedState,
            imageReference: infrastructureResources.imageReference,
            desiredSpec: infrastructureResources.desiredSpec,
            nodeId: infrastructureNodes.id,
            nodeName: infrastructureNodes.name,
            nodeStatus: infrastructureNodes.status,
            agentVersion: infrastructureNodes.agentVersion,
          })
          .from(infrastructureResources)
          .innerJoin(
            infrastructureNodes,
            eq(infrastructureNodes.id, infrastructureResources.nodeId),
          )
          .innerJoin(
            infrastructureTemplates,
            eq(infrastructureTemplates.id, infrastructureResources.templateId),
          )
          .leftJoin(
            infrastructureDatabaseClusters,
            eq(infrastructureDatabaseClusters.primaryResourceId, infrastructureResources.id),
          )
          .where(
            and(
              eq(infrastructureResources.kind, 'database'),
              eq(infrastructureTemplates.slug, 'postgresql'),
              isNull(infrastructureResources.deletedAt),
              isNull(infrastructureDatabaseClusters.id),
            ),
          )
          .orderBy(asc(infrastructureResources.name)),
        this.database
          .select({
            id: infrastructureServiceDatabases.id,
            serviceId: services.id,
            serviceNumber: services.serviceNumber,
            serviceName: services.name,
            customerName: customers.name,
            databaseClusterId: infrastructureDatabaseClusters.id,
            clusterName: infrastructureDatabaseClusters.name,
            applicationResourceId: infrastructureResources.id,
            applicationName: infrastructureResources.name,
            nodeName: infrastructureNodes.name,
            databaseName: infrastructureServiceDatabases.databaseName,
            roleName: infrastructureServiceDatabases.roleName,
            environmentKey: infrastructureServiceDatabases.environmentKey,
            status: infrastructureServiceDatabases.status,
            lastError: infrastructureServiceDatabases.lastError,
            provisioningOperationId: infrastructureServiceDatabases.provisioningOperationId,
            redeployOperationId: infrastructureServiceDatabases.redeployOperationId,
            provisionedAt: infrastructureServiceDatabases.provisionedAt,
            createdAt: infrastructureServiceDatabases.createdAt,
            updatedAt: infrastructureServiceDatabases.updatedAt,
          })
          .from(infrastructureServiceDatabases)
          .innerJoin(services, eq(services.id, infrastructureServiceDatabases.serviceId))
          .innerJoin(customers, eq(customers.id, services.customerId))
          .innerJoin(
            infrastructureDatabaseClusters,
            eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId),
          )
          .innerJoin(
            infrastructureResources,
            eq(infrastructureResources.id, infrastructureServiceDatabases.applicationResourceId),
          )
          .innerJoin(
            infrastructureNodes,
            eq(infrastructureNodes.id, infrastructureResources.nodeId),
          )
          .where(isNull(infrastructureServiceDatabases.deletedAt))
          .orderBy(asc(services.serviceNumber)),
        this.database
          .select({
            id: services.id,
            serviceNumber: services.serviceNumber,
            name: services.name,
            customerId: services.customerId,
            customerName: customers.name,
            status: services.status,
          })
          .from(services)
          .innerJoin(customers, eq(customers.id, services.customerId))
          .leftJoin(
            infrastructureServiceDatabases,
            and(
              eq(infrastructureServiceDatabases.serviceId, services.id),
              isNull(infrastructureServiceDatabases.deletedAt),
            ),
          )
          .where(and(ne(services.status, 'cancelled'), isNull(infrastructureServiceDatabases.id)))
          .orderBy(asc(services.serviceNumber)),
        this.database
          .select({
            id: infrastructureResources.id,
            name: infrastructureResources.name,
            customerId: infrastructureResources.customerId,
            nodeId: infrastructureResources.nodeId,
            nodeName: infrastructureNodes.name,
            observedState: infrastructureResources.observedState,
          })
          .from(infrastructureResources)
          .innerJoin(
            infrastructureNodes,
            eq(infrastructureNodes.id, infrastructureResources.nodeId),
          )
          .leftJoin(
            infrastructureServiceDatabases,
            and(
              eq(infrastructureServiceDatabases.applicationResourceId, infrastructureResources.id),
              isNull(infrastructureServiceDatabases.deletedAt),
            ),
          )
          .where(
            and(
              eq(infrastructureResources.kind, 'application'),
              isNull(infrastructureResources.deletedAt),
              isNull(infrastructureServiceDatabases.id),
            ),
          )
          .orderBy(asc(infrastructureResources.name)),
        this.database
          .select({
            id: infrastructureDatabaseBackups.id,
            serviceDatabaseId: infrastructureDatabaseBackups.serviceDatabaseId,
            status: infrastructureDatabaseBackups.status,
            checksumSha256: infrastructureDatabaseBackups.checksumSha256,
            sizeBytes: infrastructureDatabaseBackups.sizeBytes,
            lastError: infrastructureDatabaseBackups.lastError,
            completedAt: infrastructureDatabaseBackups.completedAt,
            restoredAt: infrastructureDatabaseBackups.restoredAt,
            createdAt: infrastructureDatabaseBackups.createdAt,
            updatedAt: infrastructureDatabaseBackups.updatedAt,
          })
          .from(infrastructureDatabaseBackups)
          .where(isNull(infrastructureDatabaseBackups.deletedAt))
          .orderBy(desc(infrastructureDatabaseBackups.createdAt)),
      ])

    return {
      clusters: clusters.map((cluster) => ({
        ...cluster,
        activatedAt: cluster.activatedAt?.toISOString() ?? null,
        createdAt: cluster.createdAt.toISOString(),
        updatedAt: cluster.updatedAt.toISOString(),
      })),
      candidates,
      allocations: allocations.map((allocation) => ({
        ...allocation,
        provisionedAt: allocation.provisionedAt?.toISOString() ?? null,
        createdAt: allocation.createdAt.toISOString(),
        updatedAt: allocation.updatedAt.toISOString(),
      })),
      eligibleServices,
      eligibleApplications,
      backups: backups.map((backup) => ({
        ...backup,
        sizeBytes: backup.sizeBytes?.toString() ?? null,
        completedAt: backup.completedAt?.toISOString() ?? null,
        restoredAt: backup.restoredAt?.toISOString() ?? null,
        createdAt: backup.createdAt.toISOString(),
        updatedAt: backup.updatedAt.toISOString(),
      })),
    }
  }

  async findOperationByIdempotencyKey(idempotencyKey: string) {
    const [operation] = await this.database
      .select()
      .from(infrastructureOperations)
      .where(eq(infrastructureOperations.idempotencyKey, idempotencyKey))
      .limit(1)
    return operation ?? null
  }

  async activate(input: ActivateNativeDatabaseClusterRecord) {
    return this.database.transaction(async (transaction) => {
      const [existingOperation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existingOperation) return { operation: existingOperation, replayed: true }

      const [candidate] = await transaction
        .select({
          resource: infrastructureResources,
          nodeStatus: infrastructureNodes.status,
          agentVersion: infrastructureNodes.agentVersion,
          templateSlug: infrastructureTemplates.slug,
        })
        .from(infrastructureResources)
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .innerJoin(
          infrastructureTemplates,
          eq(infrastructureTemplates.id, infrastructureResources.templateId),
        )
        .where(
          and(
            eq(infrastructureResources.id, input.input.resourceId),
            eq(infrastructureResources.kind, 'database'),
            isNull(infrastructureResources.deletedAt),
            eq(infrastructureNodes.isActive, true),
            eq(infrastructureNodes.isDraining, false),
            inArray(infrastructureNodes.status, ['online', 'degraded']),
          ),
        )
        .limit(1)
        .for('update')
      if (!candidate || candidate.templateSlug !== 'postgresql') return null

      const [existingCluster] = await transaction
        .select({ id: infrastructureDatabaseClusters.id })
        .from(infrastructureDatabaseClusters)
        .where(eq(infrastructureDatabaseClusters.primaryResourceId, candidate.resource.id))
        .limit(1)
      if (existingCluster) return { conflict: true as const }
      if (candidate.resource.observedState !== 'running') return { unavailable: true as const }
      if (!supportsClusterActivation(candidate.agentVersion)) {
        return { incompatibleAgent: true as const }
      }

      const spec = candidate.resource.desiredSpec as { environment?: Record<string, string> }
      const adminDatabase = spec.environment?.POSTGRES_DB || 'postgres'
      const provisionerUsername = spec.environment?.POSTGRES_USER || 'postgres'

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          id: input.operationId,
          nodeId: candidate.resource.nodeId,
          resourceId: candidate.resource.id,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: 'database.cluster.activate',
          expectedResourceRevision: candidate.resource.desiredRevision,
          expiresAt: input.expiresAt,
          payload: {
            clusterId: input.clusterId,
            resourceId: candidate.resource.id,
            adminDatabase,
            provisionerUsername,
          },
        })
        .returning()
      if (!operation) throw new Error('Failed to create database cluster operation.')

      const [cluster] = await transaction
        .insert(infrastructureDatabaseClusters)
        .values({
          id: input.clusterId,
          name: input.input.name,
          primaryResourceId: candidate.resource.id,
          activationOperationId: operation.id,
          adminDatabase,
          provisionerUsername,
          defaultConnectionLimit: input.input.defaultConnectionLimit,
          status: 'validating',
          isActive: false,
          createdBy: input.actorUserId,
        })
        .returning()
      if (!cluster) throw new Error('Failed to create native database cluster.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.database-cluster.activation-requested',
        entityType: 'infrastructure_database_cluster',
        entityId: cluster.id,
        metadata: {
          resourceId: candidate.resource.id,
          nodeId: candidate.resource.nodeId,
          operationId: operation.id,
          mode: 'standalone',
        },
      })
      return { cluster, operation, replayed: false }
    })
  }

  async provisionServiceDatabase(input: ProvisionNativeServiceDatabaseRecord) {
    return this.database.transaction(async (transaction) => {
      const [existingOperation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existingOperation) return { operation: existingOperation, replayed: true }

      const [cluster] = await transaction
        .select({
          cluster: infrastructureDatabaseClusters,
          primaryResource: infrastructureResources,
          nodeStatus: infrastructureNodes.status,
          nodeActive: infrastructureNodes.isActive,
          nodeDraining: infrastructureNodes.isDraining,
          agentVersion: infrastructureNodes.agentVersion,
        })
        .from(infrastructureDatabaseClusters)
        .innerJoin(
          infrastructureResources,
          eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId),
        )
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(eq(infrastructureDatabaseClusters.id, input.clusterId))
        .limit(1)
        .for('update')
      if (!cluster) return null
      if (
        !cluster.cluster.isActive ||
        cluster.cluster.status !== 'active' ||
        cluster.primaryResource.observedState !== 'running' ||
        !cluster.nodeActive ||
        cluster.nodeDraining ||
        !['online', 'degraded'].includes(cluster.nodeStatus)
      ) {
        return { unavailable: true as const }
      }
      if (!supportsServiceDatabaseProvisioning(cluster.agentVersion)) {
        return { incompatibleAgent: true as const }
      }

      const [service] = await transaction
        .select({
          id: services.id,
          customerId: services.customerId,
          status: services.status,
        })
        .from(services)
        .where(eq(services.id, input.input.serviceId))
        .limit(1)
        .for('update')
      if (!service || service.status === 'cancelled') return { invalidService: true as const }

      const [application] = await transaction
        .select()
        .from(infrastructureResources)
        .where(
          and(
            eq(infrastructureResources.id, input.input.applicationResourceId),
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!application) return { invalidApplication: true as const }
      if (application.nodeId !== cluster.primaryResource.nodeId) {
        return { differentNode: true as const }
      }
      if (application.customerId && application.customerId !== service.customerId) {
        return { customerMismatch: true as const }
      }

      const [existingAllocation] = await transaction
        .select({ id: infrastructureServiceDatabases.id })
        .from(infrastructureServiceDatabases)
        .where(
          and(
            isNull(infrastructureServiceDatabases.deletedAt),
            inArray(infrastructureServiceDatabases.serviceId, [service.id]),
          ),
        )
        .limit(1)
      if (existingAllocation) return { conflict: true as const }

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          id: input.operationId,
          nodeId: cluster.primaryResource.nodeId,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: 'database.service.ensure',
          expiresAt: input.expiresAt,
          payload: {
            allocationId: input.allocationId,
            clusterId: cluster.cluster.id,
            resourceId: cluster.primaryResource.id,
            applicationResourceId: application.id,
            adminDatabase: cluster.cluster.adminDatabase,
            provisionerUsername: cluster.cluster.provisionerUsername,
            databaseName: input.databaseName,
            roleName: input.roleName,
            connectionLimit: cluster.cluster.defaultConnectionLimit,
            networkAlias: input.networkAlias,
          },
        })
        .returning()
      if (!operation) throw new Error('Failed to create service database operation.')

      const [allocation] = await transaction
        .insert(infrastructureServiceDatabases)
        .values({
          id: input.allocationId,
          serviceId: service.id,
          databaseClusterId: cluster.cluster.id,
          applicationResourceId: application.id,
          provisioningOperationId: operation.id,
          databaseName: input.databaseName,
          roleName: input.roleName,
          passwordEncrypted: input.passwordEncrypted,
          connectionUriEncrypted: input.connectionUriEncrypted,
          environmentKey: input.input.environmentKey,
          createdBy: input.actorUserId,
        })
        .returning()
      if (!allocation) throw new Error('Failed to create service database allocation.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.service-database.provisioning-requested',
        entityType: 'infrastructure_service_database',
        entityId: allocation.id,
        metadata: {
          clusterId: cluster.cluster.id,
          serviceId: service.id,
          applicationResourceId: application.id,
          operationId: operation.id,
          databaseName: allocation.databaseName,
          roleName: allocation.roleName,
          secretKeys: ['DATABASE_PASSWORD'],
        },
      })
      return { allocation, operation, replayed: false }
    })
  }

  async revealServiceDatabase(allocationId: string, actorUserId: string) {
    return this.database.transaction(async (transaction) => {
      const [allocation] = await transaction
        .select({
          id: infrastructureServiceDatabases.id,
          serviceId: infrastructureServiceDatabases.serviceId,
          clusterName: infrastructureDatabaseClusters.name,
          applicationName: infrastructureResources.name,
          databaseName: infrastructureServiceDatabases.databaseName,
          roleName: infrastructureServiceDatabases.roleName,
          environmentKey: infrastructureServiceDatabases.environmentKey,
          status: infrastructureServiceDatabases.status,
          passwordEncrypted: infrastructureServiceDatabases.passwordEncrypted,
          connectionUriEncrypted: infrastructureServiceDatabases.connectionUriEncrypted,
        })
        .from(infrastructureServiceDatabases)
        .innerJoin(
          infrastructureDatabaseClusters,
          eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId),
        )
        .innerJoin(
          infrastructureResources,
          eq(infrastructureResources.id, infrastructureServiceDatabases.applicationResourceId),
        )
        .where(
          and(
            eq(infrastructureServiceDatabases.id, allocationId),
            isNull(infrastructureServiceDatabases.deletedAt),
          ),
        )
        .limit(1)
      if (!allocation) return null

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.service-database.credential-revealed',
        entityType: 'infrastructure_service_database',
        entityId: allocation.id,
        metadata: {
          serviceId: allocation.serviceId,
          secretKeys: ['DATABASE_PASSWORD', allocation.environmentKey],
        },
      })
      return allocation
    })
  }

  async reprovisionServiceDatabase(input: ReprovisionNativeServiceDatabaseRecord) {
    return this.database.transaction(async (transaction) => {
      const [existingOperation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existingOperation) return { operation: existingOperation, replayed: true }

      const [context] = await transaction
        .select({
          allocation: infrastructureServiceDatabases,
          cluster: infrastructureDatabaseClusters,
          primaryResource: infrastructureResources,
          nodeStatus: infrastructureNodes.status,
          nodeActive: infrastructureNodes.isActive,
          nodeDraining: infrastructureNodes.isDraining,
          agentVersion: infrastructureNodes.agentVersion,
        })
        .from(infrastructureServiceDatabases)
        .innerJoin(
          infrastructureDatabaseClusters,
          eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId),
        )
        .innerJoin(
          infrastructureResources,
          eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId),
        )
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(
          and(
            eq(infrastructureServiceDatabases.id, input.allocationId),
            isNull(infrastructureServiceDatabases.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!context) return null
      if (input.mode === 'retry' && context.allocation.status !== 'failed') {
        return { invalidState: true as const }
      }
      if (input.mode === 'rotate' && context.allocation.status !== 'active') {
        return { invalidState: true as const }
      }
      if (
        !context.cluster.isActive ||
        context.cluster.status !== 'active' ||
        context.primaryResource.observedState !== 'running' ||
        !context.nodeActive ||
        context.nodeDraining ||
        !['online', 'degraded'].includes(context.nodeStatus)
      ) {
        return { unavailable: true as const }
      }
      if (!supportsServiceDatabaseProvisioning(context.agentVersion)) {
        return { incompatibleAgent: true as const }
      }

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          id: input.operationId,
          nodeId: context.primaryResource.nodeId,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: 'database.service.ensure',
          expiresAt: input.expiresAt,
          payload: {
            allocationId: context.allocation.id,
            clusterId: context.cluster.id,
            resourceId: context.primaryResource.id,
            applicationResourceId: context.allocation.applicationResourceId,
            adminDatabase: context.cluster.adminDatabase,
            provisionerUsername: context.cluster.provisionerUsername,
            databaseName: context.allocation.databaseName,
            roleName: context.allocation.roleName,
            connectionLimit: context.cluster.defaultConnectionLimit,
            networkAlias: `oc-${context.primaryResource.id.replaceAll('-', '')}`,
          },
        })
        .returning()
      if (!operation) throw new Error('Failed to create database reprovision operation.')

      await transaction
        .update(infrastructureServiceDatabases)
        .set({
          provisioningOperationId: operation.id,
          redeployOperationId: null,
          passwordEncrypted: input.passwordEncrypted ?? context.allocation.passwordEncrypted,
          connectionUriEncrypted:
            input.connectionUriEncrypted ?? context.allocation.connectionUriEncrypted,
          status: 'provisioning',
          lastError: null,
          provisionedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(infrastructureServiceDatabases.id, context.allocation.id))

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action:
          input.mode === 'rotate'
            ? 'infrastructure.service-database.rotation-requested'
            : 'infrastructure.service-database.retry-requested',
        entityType: 'infrastructure_service_database',
        entityId: context.allocation.id,
        metadata: {
          operationId: operation.id,
          serviceId: context.allocation.serviceId,
          mode: input.mode,
          secretKeys: ['DATABASE_PASSWORD'],
        },
      })
      return { allocation: context.allocation, operation, replayed: false }
    })
  }

  async createBackup(input: CreateDatabaseBackupRecord) {
    return this.database.transaction(async (transaction) => {
      const [existingOperation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existingOperation) return { operation: existingOperation, replayed: true }

      const [context] = await transaction
        .select({
          allocation: infrastructureServiceDatabases,
          cluster: infrastructureDatabaseClusters,
          resource: infrastructureResources,
          nodeStatus: infrastructureNodes.status,
          nodeActive: infrastructureNodes.isActive,
          nodeDraining: infrastructureNodes.isDraining,
          agentVersion: infrastructureNodes.agentVersion,
        })
        .from(infrastructureServiceDatabases)
        .innerJoin(infrastructureDatabaseClusters, eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId))
        .innerJoin(infrastructureResources, eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId))
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(and(eq(infrastructureServiceDatabases.id, input.allocationId), isNull(infrastructureServiceDatabases.deletedAt)))
        .limit(1)
        .for('update')
      if (!context) return null
      if (context.allocation.status !== 'active' || !context.cluster.isActive || context.cluster.status !== 'active' || context.resource.observedState !== 'running' || !context.nodeActive || context.nodeDraining || !['online', 'degraded'].includes(context.nodeStatus)) {
        return { unavailable: true as const }
      }
      if (!supportsDatabaseBackup(context.agentVersion)) return { incompatibleAgent: true as const }

      const [operation] = await transaction.insert(infrastructureOperations).values({
        id: input.operationId,
        nodeId: context.resource.nodeId,
        resourceId: context.resource.id,
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        action: 'database.backup.create',
        expiresAt: input.expiresAt,
        payload: {
          backupId: input.backupId,
          allocationId: context.allocation.id,
          clusterId: context.cluster.id,
          resourceId: context.resource.id,
          databaseName: context.allocation.databaseName,
          provisionerUsername: context.cluster.provisionerUsername,
          storageTargetId: input.storageTargetId,
          objectStorage: input.objectStorage,
        },
      }).returning()
      if (!operation) throw new Error('Failed to create database backup operation.')
      const [backup] = await transaction.insert(infrastructureDatabaseBackups).values({
        id: input.backupId,
        serviceDatabaseId: context.allocation.id,
        createOperationId: operation.id,
        policyId: input.policyId,
        storageTargetId: input.storageTargetId,
        objectKey: input.objectKey,
        createdBy: input.actorUserId,
      }).returning()
      if (!backup) throw new Error('Failed to create database backup record.')
      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.database-backup.requested',
        entityType: 'infrastructure_database_backup',
        entityId: backup.id,
        metadata: { allocationId: context.allocation.id, operationId: operation.id },
      })
      return { backup, operation, replayed: false }
    })
  }

  async restoreBackup(input: RestoreDatabaseBackupRecord) {
    return this.database.transaction(async (transaction) => {
      const [existingOperation] = await transaction.select().from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey)).limit(1)
      if (existingOperation) return { operation: existingOperation, replayed: true }
      const [context] = await transaction.select({
        backup: infrastructureDatabaseBackups,
        allocation: infrastructureServiceDatabases,
        cluster: infrastructureDatabaseClusters,
        resource: infrastructureResources,
        nodeStatus: infrastructureNodes.status,
        nodeActive: infrastructureNodes.isActive,
        nodeDraining: infrastructureNodes.isDraining,
        agentVersion: infrastructureNodes.agentVersion,
        targetEndpoint: infrastructureBackupTargets.endpoint,
        targetRegion: infrastructureBackupTargets.region,
        targetBucket: infrastructureBackupTargets.bucket,
        targetPathStyle: infrastructureBackupTargets.pathStyle,
      }).from(infrastructureDatabaseBackups)
        .innerJoin(infrastructureServiceDatabases, eq(infrastructureServiceDatabases.id, infrastructureDatabaseBackups.serviceDatabaseId))
        .innerJoin(infrastructureDatabaseClusters, eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId))
        .innerJoin(infrastructureResources, eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId))
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .leftJoin(infrastructureBackupTargets, eq(infrastructureBackupTargets.id, infrastructureDatabaseBackups.storageTargetId))
        .where(eq(infrastructureDatabaseBackups.id, input.backupId)).limit(1).for('update')
      if (!context) return null
      if (context.backup.status !== 'available' || !context.backup.checksumSha256 || context.allocation.status !== 'active' || !context.cluster.isActive || context.resource.observedState !== 'running' || !context.nodeActive || context.nodeDraining || !['online', 'degraded'].includes(context.nodeStatus)) {
        return { unavailable: true as const }
      }
      if (!supportsDatabaseBackup(context.agentVersion)) return { incompatibleAgent: true as const }
      const [operation] = await transaction.insert(infrastructureOperations).values({
        id: input.operationId,
        nodeId: context.resource.nodeId,
        resourceId: context.resource.id,
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        action: 'database.backup.restore',
        expiresAt: input.expiresAt,
        payload: {
          backupId: context.backup.id,
          allocationId: context.allocation.id,
          clusterId: context.cluster.id,
          resourceId: context.resource.id,
          databaseName: context.allocation.databaseName,
          provisionerUsername: context.cluster.provisionerUsername,
          checksumSha256: context.backup.checksumSha256,
          storageTargetId: context.backup.storageTargetId,
          objectStorage: context.backup.storageTargetId && context.backup.objectKey && context.targetEndpoint && context.targetRegion && context.targetBucket
            ? {
                provider: 's3',
                endpoint: context.targetEndpoint,
                region: context.targetRegion,
                bucket: context.targetBucket,
                objectKey: context.backup.objectKey,
                pathStyle: context.targetPathStyle ?? false,
              }
            : undefined,
        },
      }).returning()
      if (!operation) throw new Error('Failed to create database restore operation.')
      await transaction.update(infrastructureDatabaseBackups).set({
        restoreOperationId: operation.id, status: 'restoring', lastError: null, updatedAt: new Date(),
      }).where(eq(infrastructureDatabaseBackups.id, context.backup.id))
      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.database-backup.restore-requested',
        entityType: 'infrastructure_database_backup',
        entityId: context.backup.id,
        metadata: { allocationId: context.allocation.id, operationId: operation.id },
      })
      return { backup: context.backup, operation, replayed: false }
    })
  }
}

function supportsClusterActivation(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 4
}

function supportsServiceDatabaseProvisioning(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 5
}

function supportsDatabaseBackup(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 10
}
