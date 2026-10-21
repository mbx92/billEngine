import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Transaction } from '../database/client'
import {
  auditLogs,
  infrastructureDatabaseClusters,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  infrastructureServiceDatabases,
} from '../database/schema'
import { encryptInfrastructureCredential } from '../utils/credentials'
import { DomainError } from '../utils/errors'

export interface CreateDeploymentDatabaseInput {
  clusterId: string
  applicationResourceId: string
  applicationNodeId: string
  serviceId?: string
  environmentKey: string
  networkName: string
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
}

export async function createDeploymentDatabase(
  transaction: Transaction,
  input: CreateDeploymentDatabaseInput,
) {
  const [cluster] = await transaction
    .select({
      id: infrastructureDatabaseClusters.id,
      status: infrastructureDatabaseClusters.status,
      isActive: infrastructureDatabaseClusters.isActive,
      adminDatabase: infrastructureDatabaseClusters.adminDatabase,
      provisionerUsername: infrastructureDatabaseClusters.provisionerUsername,
      defaultConnectionLimit: infrastructureDatabaseClusters.defaultConnectionLimit,
      primaryResourceId: infrastructureResources.id,
      primaryNodeId: infrastructureResources.nodeId,
      resourceState: infrastructureResources.observedState,
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

  if (!cluster) throw DomainError.notFound('Database cluster tidak ditemukan.')
  if (
    !cluster.isActive ||
    cluster.status !== 'active' ||
    cluster.resourceState !== 'running' ||
    !cluster.nodeActive ||
    cluster.nodeDraining ||
    !['online', 'degraded'].includes(cluster.nodeStatus)
  ) {
    throw DomainError.invalidState('Database cluster belum siap menerima deployment.')
  }
  if (!supportsManagedDatabase(cluster.agentVersion)) {
    throw DomainError.invalidState('Managed database membutuhkan OC Agent 0.5.0 atau lebih baru.')
  }
  if (cluster.primaryNodeId !== input.applicationNodeId) {
    throw DomainError.validation('Aplikasi dan database cluster harus berada pada node yang sama.')
  }

  const [existingAllocation] = await transaction
    .select({ id: infrastructureServiceDatabases.id })
    .from(infrastructureServiceDatabases)
    .where(
      and(
        eq(infrastructureServiceDatabases.applicationResourceId, input.applicationResourceId),
        isNull(infrastructureServiceDatabases.deletedAt),
      ),
    )
    .limit(1)
  if (existingAllocation) throw DomainError.conflict('Aplikasi sudah memiliki managed database.')

  const allocationId = randomUUID()
  const operationId = randomUUID()
  const identifier = allocationId.replaceAll('-', '').slice(0, 24)
  const databaseName = `oc_${identifier}`
  const roleName = `${databaseName}_app`
  const password = randomBytes(32).toString('base64url')
  const networkAlias = `oc-${cluster.primaryResourceId.replaceAll('-', '')}`
  const connectionUri = `postgresql://${encodeURIComponent(roleName)}:${encodeURIComponent(password)}@${networkAlias}:5432/${databaseName}?sslmode=disable`

  const [operation] = await transaction
    .insert(infrastructureOperations)
    .values({
      id: operationId,
      nodeId: input.applicationNodeId,
      resourceId: input.applicationResourceId,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      action: 'database.service.ensure',
      expiresAt: input.expiresAt,
      payload: {
        allocationId,
        clusterId: cluster.id,
        resourceId: cluster.primaryResourceId,
        applicationResourceId: input.applicationResourceId,
        adminDatabase: cluster.adminDatabase,
        provisionerUsername: cluster.provisionerUsername,
        databaseName,
        roleName,
        connectionLimit: cluster.defaultConnectionLimit,
        networkAlias,
        networkName: input.networkName,
      },
    })
    .returning()
  if (!operation) throw new Error('Failed to create managed database operation.')

  const [allocation] = await transaction
    .insert(infrastructureServiceDatabases)
    .values({
      id: allocationId,
      serviceId: input.serviceId,
      databaseClusterId: cluster.id,
      applicationResourceId: input.applicationResourceId,
      provisioningOperationId: operation.id,
      databaseName,
      roleName,
      passwordEncrypted: encryptInfrastructureCredential(password),
      connectionUriEncrypted: encryptInfrastructureCredential(connectionUri),
      environmentKey: input.environmentKey,
      createdBy: input.actorUserId,
    })
    .returning()
  if (!allocation) throw new Error('Failed to create managed database allocation.')

  await transaction.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: 'infrastructure.application-database.provisioning-requested',
    entityType: 'infrastructure_service_database',
    entityId: allocation.id,
    metadata: {
      clusterId: cluster.id,
      serviceId: input.serviceId ?? null,
      applicationResourceId: input.applicationResourceId,
      operationId: operation.id,
      databaseName,
      roleName,
      environmentKey: input.environmentKey,
      networkName: input.networkName,
    },
  })

  return { allocation, operation }
}

function supportsManagedDatabase(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 5
}
