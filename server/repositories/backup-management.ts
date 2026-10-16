import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm'
import type { CreateBackupPolicyInput } from '../../shared/schemas/backups'
import { useDatabase, type Database } from '../database/client'
import {
  auditLogs,
  customers,
  infrastructureBackupPolicies,
  infrastructureBackupTargets,
  infrastructureDatabaseBackups,
  infrastructureDatabaseClusters,
  infrastructureNodes,
  infrastructureResources,
  infrastructureServiceDatabases,
  services,
} from '../database/schema'

export class BackupManagementRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async overview() {
    const [targets, policies, runs, sources] = await Promise.all([
      this.database
        .select({
          id: infrastructureBackupTargets.id,
          name: infrastructureBackupTargets.name,
          provider: infrastructureBackupTargets.provider,
          endpoint: infrastructureBackupTargets.endpoint,
          region: infrastructureBackupTargets.region,
          bucket: infrastructureBackupTargets.bucket,
          prefix: infrastructureBackupTargets.prefix,
          pathStyle: infrastructureBackupTargets.pathStyle,
          isActive: infrastructureBackupTargets.isActive,
          createdAt: infrastructureBackupTargets.createdAt,
          updatedAt: infrastructureBackupTargets.updatedAt,
        })
        .from(infrastructureBackupTargets)
        .orderBy(asc(infrastructureBackupTargets.name)),
      this.database
        .select({
          id: infrastructureBackupPolicies.id,
          name: infrastructureBackupPolicies.name,
          serviceDatabaseId: infrastructureBackupPolicies.serviceDatabaseId,
          storageTargetId: infrastructureBackupPolicies.storageTargetId,
          intervalMinutes: infrastructureBackupPolicies.intervalMinutes,
          retentionCount: infrastructureBackupPolicies.retentionCount,
          alertEmail: infrastructureBackupPolicies.alertEmail,
          isActive: infrastructureBackupPolicies.isActive,
          nextRunAt: infrastructureBackupPolicies.nextRunAt,
          lastRunAt: infrastructureBackupPolicies.lastRunAt,
          databaseName: infrastructureServiceDatabases.databaseName,
          serviceNumber: services.serviceNumber,
          serviceName: services.name,
          targetName: infrastructureBackupTargets.name,
          createdAt: infrastructureBackupPolicies.createdAt,
        })
        .from(infrastructureBackupPolicies)
        .innerJoin(
          infrastructureServiceDatabases,
          eq(infrastructureServiceDatabases.id, infrastructureBackupPolicies.serviceDatabaseId),
        )
        .innerJoin(services, eq(services.id, infrastructureServiceDatabases.serviceId))
        .innerJoin(
          infrastructureBackupTargets,
          eq(infrastructureBackupTargets.id, infrastructureBackupPolicies.storageTargetId),
        )
        .orderBy(asc(infrastructureBackupPolicies.name)),
      this.database
        .select({
          id: infrastructureDatabaseBackups.id,
          serviceDatabaseId: infrastructureDatabaseBackups.serviceDatabaseId,
          policyId: infrastructureDatabaseBackups.policyId,
          storageTargetId: infrastructureDatabaseBackups.storageTargetId,
          status: infrastructureDatabaseBackups.status,
          storagePath: infrastructureDatabaseBackups.storagePath,
          objectKey: infrastructureDatabaseBackups.objectKey,
          checksumSha256: infrastructureDatabaseBackups.checksumSha256,
          sizeBytes: infrastructureDatabaseBackups.sizeBytes,
          lastError: infrastructureDatabaseBackups.lastError,
          completedAt: infrastructureDatabaseBackups.completedAt,
          restoredAt: infrastructureDatabaseBackups.restoredAt,
          expiresAt: infrastructureDatabaseBackups.expiresAt,
          createdAt: infrastructureDatabaseBackups.createdAt,
          databaseName: infrastructureServiceDatabases.databaseName,
          serviceNumber: services.serviceNumber,
          serviceName: services.name,
          clusterName: infrastructureDatabaseClusters.name,
          nodeName: infrastructureNodes.name,
          targetName: infrastructureBackupTargets.name,
        })
        .from(infrastructureDatabaseBackups)
        .innerJoin(
          infrastructureServiceDatabases,
          eq(infrastructureServiceDatabases.id, infrastructureDatabaseBackups.serviceDatabaseId),
        )
        .innerJoin(services, eq(services.id, infrastructureServiceDatabases.serviceId))
        .innerJoin(
          infrastructureDatabaseClusters,
          eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId),
        )
        .innerJoin(
          infrastructureResources,
          eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId),
        )
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .leftJoin(
          infrastructureBackupTargets,
          eq(infrastructureBackupTargets.id, infrastructureDatabaseBackups.storageTargetId),
        )
        .where(isNull(infrastructureDatabaseBackups.deletedAt))
        .orderBy(desc(infrastructureDatabaseBackups.createdAt))
        .limit(250),
      this.database
        .select({
          id: infrastructureServiceDatabases.id,
          databaseName: infrastructureServiceDatabases.databaseName,
          status: infrastructureServiceDatabases.status,
          serviceNumber: services.serviceNumber,
          serviceName: services.name,
          customerName: customers.name,
          clusterName: infrastructureDatabaseClusters.name,
          nodeName: infrastructureNodes.name,
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
          eq(infrastructureResources.id, infrastructureDatabaseClusters.primaryResourceId),
        )
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(isNull(infrastructureServiceDatabases.deletedAt))
        .orderBy(asc(services.serviceNumber)),
    ])

    return {
      targets: targets.map(serializeDates),
      policies: policies.map(serializeDates),
      runs: runs.map((run) => ({
        ...serializeDates(run),
        sizeBytes: run.sizeBytes?.toString() ?? null,
      })),
      sources,
    }
  }

  async createTarget(input: {
    id: string
    actorUserId: string
    name: string
    endpoint: string
    region: string
    bucket: string
    prefix: string
    pathStyle: boolean
    accessKeyEncrypted: string
    secretKeyEncrypted: string
  }) {
    return this.database.transaction(async (transaction) => {
      const [target] = await transaction
        .insert(infrastructureBackupTargets)
        .values({
          id: input.id,
          name: input.name,
          endpoint: input.endpoint,
          region: input.region,
          bucket: input.bucket,
          prefix: input.prefix,
          pathStyle: input.pathStyle,
          accessKeyEncrypted: input.accessKeyEncrypted,
          secretKeyEncrypted: input.secretKeyEncrypted,
          createdBy: input.actorUserId,
        })
        .returning()
      if (!target) throw new Error('Failed to create backup target.')
      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.backup-target.created',
        entityType: 'infrastructure_backup_target',
        entityId: target.id,
        metadata: { provider: target.provider, bucket: target.bucket, region: target.region },
      })
      return target
    })
  }

  async createPolicy(input: CreateBackupPolicyInput & { id: string; actorUserId: string }) {
    return this.database.transaction(async (transaction) => {
      const [source] = await transaction
        .select({ id: infrastructureServiceDatabases.id })
        .from(infrastructureServiceDatabases)
        .where(
          and(
            eq(infrastructureServiceDatabases.id, input.serviceDatabaseId),
            eq(infrastructureServiceDatabases.status, 'active'),
            isNull(infrastructureServiceDatabases.deletedAt),
          ),
        )
        .limit(1)
      const [target] = await transaction
        .select({ id: infrastructureBackupTargets.id })
        .from(infrastructureBackupTargets)
        .where(
          and(
            eq(infrastructureBackupTargets.id, input.storageTargetId),
            eq(infrastructureBackupTargets.isActive, true),
          ),
        )
        .limit(1)
      if (!source || !target) return null
      const [policy] = await transaction
        .insert(infrastructureBackupPolicies)
        .values({
          id: input.id,
          name: input.name,
          serviceDatabaseId: input.serviceDatabaseId,
          storageTargetId: input.storageTargetId,
          intervalMinutes: input.intervalMinutes,
          retentionCount: input.retentionCount,
          alertEmail: input.alertEmail || null,
          nextRunAt: new Date(),
          createdBy: input.actorUserId,
        })
        .returning()
      if (!policy) throw new Error('Failed to create backup policy.')
      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.backup-policy.created',
        entityType: 'infrastructure_backup_policy',
        entityId: policy.id,
        metadata: {
          serviceDatabaseId: policy.serviceDatabaseId,
          storageTargetId: policy.storageTargetId,
          intervalMinutes: policy.intervalMinutes,
          retentionCount: policy.retentionCount,
        },
      })
      return policy
    })
  }

  async listDuePolicies(now = new Date()) {
    return this.database
      .select({
        id: infrastructureBackupPolicies.id,
        actorUserId: infrastructureBackupPolicies.createdBy,
        serviceDatabaseId: infrastructureBackupPolicies.serviceDatabaseId,
        storageTargetId: infrastructureBackupPolicies.storageTargetId,
        intervalMinutes: infrastructureBackupPolicies.intervalMinutes,
        retentionCount: infrastructureBackupPolicies.retentionCount,
        policyName: infrastructureBackupPolicies.name,
        alertEmail: infrastructureBackupPolicies.alertEmail,
        databaseName: infrastructureServiceDatabases.databaseName,
        scheduledAt: infrastructureBackupPolicies.nextRunAt,
        targetEndpoint: infrastructureBackupTargets.endpoint,
        targetRegion: infrastructureBackupTargets.region,
        targetBucket: infrastructureBackupTargets.bucket,
        targetPrefix: infrastructureBackupTargets.prefix,
        targetPathStyle: infrastructureBackupTargets.pathStyle,
      })
      .from(infrastructureBackupPolicies)
      .innerJoin(
        infrastructureBackupTargets,
        eq(infrastructureBackupTargets.id, infrastructureBackupPolicies.storageTargetId),
      )
      .innerJoin(
        infrastructureServiceDatabases,
        eq(infrastructureServiceDatabases.id, infrastructureBackupPolicies.serviceDatabaseId),
      )
      .where(
        and(
          eq(infrastructureBackupPolicies.isActive, true),
          eq(infrastructureBackupTargets.isActive, true),
          lte(infrastructureBackupPolicies.nextRunAt, now),
        ),
      )
      .orderBy(asc(infrastructureBackupPolicies.nextRunAt))
      .limit(50)
  }

  async advancePolicy(id: string, scheduledAt: Date, intervalMinutes: number) {
    const now = new Date()
    let nextRunAt = new Date(scheduledAt.getTime() + intervalMinutes * 60_000)
    while (nextRunAt <= now) nextRunAt = new Date(nextRunAt.getTime() + intervalMinutes * 60_000)
    await this.database
      .update(infrastructureBackupPolicies)
      .set({ lastRunAt: now, nextRunAt, updatedAt: now })
      .where(
        and(
          eq(infrastructureBackupPolicies.id, id),
          eq(infrastructureBackupPolicies.nextRunAt, scheduledAt),
        ),
      )
  }

  async findTargetSecrets(targetId: string) {
    const [target] = await this.database
      .select({
        accessKeyEncrypted: infrastructureBackupTargets.accessKeyEncrypted,
        secretKeyEncrypted: infrastructureBackupTargets.secretKeyEncrypted,
      })
      .from(infrastructureBackupTargets)
      .where(eq(infrastructureBackupTargets.id, targetId))
      .limit(1)
    return target ?? null
  }

  async listPendingAlerts() {
    return this.database
      .select({
        backupId: infrastructureDatabaseBackups.id,
        email: infrastructureBackupPolicies.alertEmail,
        policyName: infrastructureBackupPolicies.name,
        databaseName: infrastructureServiceDatabases.databaseName,
        status: infrastructureDatabaseBackups.status,
        error: infrastructureDatabaseBackups.lastError,
        createdAt: infrastructureDatabaseBackups.createdAt,
      })
      .from(infrastructureDatabaseBackups)
      .innerJoin(
        infrastructureBackupPolicies,
        eq(infrastructureBackupPolicies.id, infrastructureDatabaseBackups.policyId),
      )
      .innerJoin(
        infrastructureServiceDatabases,
        eq(infrastructureServiceDatabases.id, infrastructureDatabaseBackups.serviceDatabaseId),
      )
      .where(
        and(
          eq(infrastructureDatabaseBackups.status, 'failed'),
          isNull(infrastructureDatabaseBackups.alertSentAt),
        ),
      )
      .orderBy(asc(infrastructureDatabaseBackups.createdAt))
      .limit(50)
  }

  async markAlertSent(backupId: string) {
    await this.database
      .update(infrastructureDatabaseBackups)
      .set({ alertSentAt: new Date(), updatedAt: new Date() })
      .where(eq(infrastructureDatabaseBackups.id, backupId))
  }
}

function serializeDates<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  ) as T
}
