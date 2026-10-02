import { and, asc, count, desc, eq, inArray, lte } from 'drizzle-orm'
import type {
  CreateDeploymentBlueprintInput,
  UpdateDeploymentBlueprintInput,
} from '../../shared/schemas/provisioning'
import type {
  ApiDeploymentBlueprint,
  ApiProvisioningJob,
  ApiProvisioningJobEvent,
  ProvisioningStatus,
} from '../../shared/types/api'
import { useDatabase, type Database } from '../database/client'
import {
  coolifyServers,
  coolifyResources,
  customers,
  databaseClusters,
  deploymentBlueprints,
  provisioningJobEvents,
  provisioningJobs,
  serviceDatabases,
  serviceResources,
  services,
} from '../database/schema'

const RUNNABLE_STATUSES: ProvisioningStatus[] = [
  'queued',
  'provisioning_database',
  'importing_database',
  'creating_application',
  'configuring_environment',
  'configuring_domain',
  'deploying',
  'verifying_health',
  'verifying_ssl',
]

export class ProvisioningRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async listBlueprints(): Promise<ApiDeploymentBlueprint[]> {
    const rows = await this.database
      .select({
        blueprint: deploymentBlueprints,
        coolifyServerName: coolifyServers.name,
      })
      .from(deploymentBlueprints)
      .innerJoin(coolifyServers, eq(coolifyServers.id, deploymentBlueprints.coolifyServerId))
      .orderBy(asc(deploymentBlueprints.name))

    return rows.map(({ blueprint, coolifyServerName }) =>
      serializeBlueprint(blueprint, coolifyServerName),
    )
  }

  async createBlueprint(input: CreateDeploymentBlueprintInput, actorUserId: string | null) {
    const [created] = await this.database
      .insert(deploymentBlueprints)
      .values({ ...input, createdBy: actorUserId })
      .returning()
    if (!created) throw new Error('Failed to create deployment blueprint.')
    return created
  }

  async updateBlueprint(id: string, input: UpdateDeploymentBlueprintInput) {
    const [updated] = await this.database
      .update(deploymentBlueprints)
      .set({
        ...input,
        description: input.description ?? null,
        destinationUuid: input.destinationUuid ?? null,
        baseDirectory: input.baseDirectory ?? null,
        dockerfileLocation: input.dockerfileLocation ?? null,
        dockerComposeLocation: input.dockerComposeLocation ?? null,
        composeServiceName: input.composeServiceName ?? null,
        portsExposes: input.portsExposes ?? null,
        healthcheckPath: input.healthcheckPath ?? null,
        healthcheckPort: input.healthcheckPort ?? null,
        customLabels: input.customLabels ?? null,
        databaseClusterId: input.databaseClusterId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(deploymentBlueprints.id, id))
      .returning()
    return updated ?? null
  }

  async deleteBlueprint(id: string) {
    const [deleted] = await this.database
      .delete(deploymentBlueprints)
      .where(eq(deploymentBlueprints.id, id))
      .returning({ id: deploymentBlueprints.id })
    return deleted ?? null
  }

  async blueprintJobCount(id: string) {
    const [row] = await this.database
      .select({ value: count() })
      .from(provisioningJobs)
      .where(eq(provisioningJobs.blueprintId, id))
    return Number(row?.value ?? 0)
  }

  async hasRunnableBlueprintJob(id: string) {
    const [row] = await this.database
      .select({ value: count() })
      .from(provisioningJobs)
      .where(
        and(
          eq(provisioningJobs.blueprintId, id),
          inArray(provisioningJobs.status, RUNNABLE_STATUSES),
        ),
      )
    return Number(row?.value ?? 0) > 0
  }

  async findBlueprint(id: string) {
    const [row] = await this.database
      .select({ blueprint: deploymentBlueprints, serverActive: coolifyServers.isActive })
      .from(deploymentBlueprints)
      .innerJoin(coolifyServers, eq(coolifyServers.id, deploymentBlueprints.coolifyServerId))
      .where(eq(deploymentBlueprints.id, id))
      .limit(1)
    return row ?? null
  }

  async listProvisionableServices() {
    const rows = await this.database
      .select({
        id: services.id,
        serviceNumber: services.serviceNumber,
        name: services.name,
        customerName: customers.name,
        planName: services.planName,
        resourceCount: count(serviceResources.id),
        databaseMode: services.planDatabaseMode,
      })
      .from(services)
      .innerJoin(customers, eq(customers.id, services.customerId))
      .leftJoin(serviceResources, eq(serviceResources.serviceId, services.id))
      .where(eq(services.status, 'active'))
      .groupBy(services.id, customers.id)
      .orderBy(asc(customers.name), asc(services.name))

    return rows.map((row) => ({ ...row, resourceCount: Number(row.resourceCount) }))
  }

  async findActiveService(id: string) {
    const [row] = await this.database
      .select({ id: services.id, databaseMode: services.planDatabaseMode })
      .from(services)
      .where(and(eq(services.id, id), eq(services.status, 'active')))
      .limit(1)
    return row ?? null
  }

  async createJob(input: {
    blueprintId: string
    serviceId: string
    requestedBy: string | null
    applicationName: string
    hostname?: string
    domainType?: 'platform' | 'custom'
    environmentEncrypted: string | null
    sqlImportEncrypted: string | null
    sqlImportFilename: string | null
    sqlImportSize: number | null
    sqlImportChecksum: string | null
  }) {
    return this.database.transaction(async (transaction) => {
      const [created] = await transaction.insert(provisioningJobs).values(input).returning()
      if (!created) throw new Error('Failed to queue provisioning job.')
      await transaction.insert(provisioningJobEvents).values({
        jobId: created.id,
        stage: 'queued',
        message: 'Provisioning job masuk antrean.',
      })
      return created
    })
  }

  async listJobs(limit = 50): Promise<ApiProvisioningJob[]> {
    const rows = await this.database
      .select({
        job: provisioningJobs,
        blueprintName: deploymentBlueprints.name,
        serviceNumber: services.serviceNumber,
        serviceName: services.name,
        customerName: customers.name,
        allocation: serviceDatabases,
        databaseClusterName: databaseClusters.name,
        resourceStatus: coolifyResources.status,
        resourceLastSyncedAt: coolifyResources.lastSyncedAt,
      })
      .from(provisioningJobs)
      .innerJoin(deploymentBlueprints, eq(deploymentBlueprints.id, provisioningJobs.blueprintId))
      .innerJoin(services, eq(services.id, provisioningJobs.serviceId))
      .innerJoin(customers, eq(customers.id, services.customerId))
      .leftJoin(serviceDatabases, eq(serviceDatabases.id, provisioningJobs.serviceDatabaseId))
      .leftJoin(databaseClusters, eq(databaseClusters.id, serviceDatabases.databaseClusterId))
      .leftJoin(coolifyResources, eq(coolifyResources.id, provisioningJobs.resourceId))
      .orderBy(desc(provisioningJobs.createdAt))
      .limit(limit)

    const events = await this.listEvents(rows.map((row) => row.job.id))
    return rows.map((row) => ({
      id: row.job.id,
      blueprintId: row.job.blueprintId,
      blueprintName: row.blueprintName,
      serviceId: row.job.serviceId,
      serviceNumber: row.serviceNumber,
      serviceName: row.serviceName,
      customerName: row.customerName,
      status: row.job.status,
      failedStage: row.job.failedStage,
      applicationName: row.job.applicationName,
      hostname: row.job.hostname,
      domainType: row.job.domainType,
      coolifyApplicationUuid: row.job.coolifyApplicationUuid,
      coolifyDeploymentUuid: row.job.coolifyDeploymentUuid,
      resourceId: row.job.resourceId,
      domainId: row.job.domainId,
      serviceDatabaseId: row.job.serviceDatabaseId,
      databaseClusterName: row.databaseClusterName,
      databaseName: row.allocation?.databaseName ?? null,
      databaseRoleName: row.allocation?.roleName ?? null,
      databaseStatus: row.allocation?.status ?? null,
      resourceStatus: row.resourceStatus,
      resourceLastSyncedAt: row.resourceLastSyncedAt?.toISOString() ?? null,
      sqlImportFilename: row.job.sqlImportFilename,
      sqlImportedAt: row.allocation?.sqlImportedAt?.toISOString() ?? null,
      attemptCount: row.job.attemptCount,
      maxAttempts: row.job.maxAttempts,
      lastError: row.job.lastError,
      nextRunAt: row.job.nextRunAt.toISOString(),
      startedAt: row.job.startedAt.toISOString(),
      completedAt: row.job.completedAt?.toISOString() ?? null,
      events: events.get(row.job.id) ?? [],
    }))
  }

  async findNextRunnable(now = new Date()) {
    const [row] = await this.database
      .select({ id: provisioningJobs.id })
      .from(provisioningJobs)
      .where(
        and(
          inArray(provisioningJobs.status, RUNNABLE_STATUSES),
          lte(provisioningJobs.nextRunAt, now),
        ),
      )
      .orderBy(asc(provisioningJobs.nextRunAt), asc(provisioningJobs.createdAt))
      .limit(1)
    return row?.id ?? null
  }

  async findJobContext(id: string) {
    const [row] = await this.database
      .select({
        job: provisioningJobs,
        blueprint: deploymentBlueprints,
        serverName: coolifyServers.name,
        baseUrl: coolifyServers.baseUrl,
        tokenEncrypted: coolifyServers.tokenEncrypted,
        serverActive: coolifyServers.isActive,
        serviceNumber: services.serviceNumber,
        serviceName: services.name,
        serviceStatus: services.status,
        planCpuCores: services.planCpuCores,
        planMemoryBytes: services.planMemoryBytes,
        planDatabaseMode: services.planDatabaseMode,
        databaseCluster: databaseClusters,
        serviceDatabase: serviceDatabases,
      })
      .from(provisioningJobs)
      .innerJoin(deploymentBlueprints, eq(deploymentBlueprints.id, provisioningJobs.blueprintId))
      .innerJoin(coolifyServers, eq(coolifyServers.id, deploymentBlueprints.coolifyServerId))
      .innerJoin(services, eq(services.id, provisioningJobs.serviceId))
      .leftJoin(databaseClusters, eq(databaseClusters.id, deploymentBlueprints.databaseClusterId))
      .leftJoin(serviceDatabases, eq(serviceDatabases.id, provisioningJobs.serviceDatabaseId))
      .where(eq(provisioningJobs.id, id))
      .limit(1)
    return row ?? null
  }

  async advance(
    id: string,
    status: ProvisioningStatus,
    values: Partial<typeof provisioningJobs.$inferInsert> = {},
    message?: string,
  ) {
    const now = new Date()
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(provisioningJobs)
        .set({
          ...values,
          status,
          failedStage: null,
          attemptCount: 0,
          lastError: null,
          nextRunAt: values.nextRunAt ?? now,
          stageStartedAt: now,
          updatedAt: now,
        })
        .where(eq(provisioningJobs.id, id))
      if (message) {
        await transaction
          .insert(provisioningJobEvents)
          .values({ jobId: id, stage: status, message })
      }
    })
  }

  async reschedule(id: string, status: ProvisioningStatus, nextRunAt: Date, message?: string) {
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(provisioningJobs)
        .set({ nextRunAt, updatedAt: new Date() })
        .where(eq(provisioningJobs.id, id))
      if (message) {
        await transaction
          .insert(provisioningJobEvents)
          .values({ jobId: id, stage: status, message })
      }
    })
  }

  async recordFailure(
    id: string,
    stage: ProvisioningStatus,
    attemptCount: number,
    maxAttempts: number,
    errorMessage: string,
    nextRunAt: Date,
  ) {
    const terminal = attemptCount >= maxAttempts
    await this.database.transaction(async (transaction) => {
      await transaction
        .update(provisioningJobs)
        .set({
          status: terminal ? 'failed' : stage,
          failedStage: terminal ? stage : null,
          ...(stage === 'deploying' ? { coolifyDeploymentUuid: null } : {}),
          attemptCount,
          lastError: errorMessage,
          nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(provisioningJobs.id, id))
      await transaction.insert(provisioningJobEvents).values({
        jobId: id,
        stage,
        level: terminal ? 'error' : 'warning',
        message: terminal
          ? `Tahap gagal setelah ${attemptCount} percobaan: ${errorMessage}`
          : `Percobaan ${attemptCount}/${maxAttempts} gagal; akan dicoba kembali: ${errorMessage}`,
      })
    })
  }

  async retry(id: string) {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(provisioningJobs)
        .where(eq(provisioningJobs.id, id))
        .limit(1)
        .for('update')
      if (!current) return null
      if (current.status !== 'failed' || !current.failedStage) return current

      const now = new Date()
      const [updated] = await transaction
        .update(provisioningJobs)
        .set({
          status: current.failedStage,
          failedStage: null,
          attemptCount: 0,
          lastError: null,
          nextRunAt: now,
          stageStartedAt: now,
          completedAt: null,
          updatedAt: now,
        })
        .where(eq(provisioningJobs.id, id))
        .returning()
      await transaction.insert(provisioningJobEvents).values({
        jobId: id,
        stage: current.failedStage,
        message: 'Retry manual diminta oleh administrator.',
      })
      return updated ?? null
    })
  }

  private async listEvents(jobIds: string[]) {
    const result = new Map<string, ApiProvisioningJobEvent[]>()
    if (jobIds.length === 0) return result
    const rows = await this.database
      .select()
      .from(provisioningJobEvents)
      .where(inArray(provisioningJobEvents.jobId, jobIds))
      .orderBy(desc(provisioningJobEvents.createdAt))

    for (const row of rows) {
      const current = result.get(row.jobId) ?? []
      if (current.length < 20) {
        current.push({
          id: row.id,
          stage: row.stage,
          level: row.level,
          message: row.message,
          createdAt: row.createdAt.toISOString(),
        })
      }
      result.set(row.jobId, current)
    }
    return result
  }
}

function serializeBlueprint(
  row: typeof deploymentBlueprints.$inferSelect,
  coolifyServerName: string,
): ApiDeploymentBlueprint {
  return {
    id: row.id,
    coolifyServerId: row.coolifyServerId,
    coolifyServerName,
    name: row.name,
    slug: row.slug,
    description: row.description,
    repositoryUrl: row.repositoryUrl,
    branch: row.branch,
    buildPack: row.buildPack,
    projectUuid: row.projectUuid,
    targetServerUuid: row.targetServerUuid,
    environmentName: row.environmentName,
    destinationUuid: row.destinationUuid,
    baseDirectory: row.baseDirectory,
    dockerfileLocation: row.dockerfileLocation,
    dockerComposeLocation: row.dockerComposeLocation,
    composeServiceName: row.composeServiceName,
    portsExposes: row.portsExposes,
    healthcheckPath: row.healthcheckPath,
    healthcheckPort: row.healthcheckPort,
    environmentKeys: row.environmentKeys,
    customLabels: row.customLabels,
    billingGateEnabled: row.billingGateEnabled,
    databaseClusterId: row.databaseClusterId,
    databaseEnvironmentKey: row.databaseEnvironmentKey,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
