import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import type {
  CreateApplicationResourceInput,
  OperationLogAppendInput,
  OperationStatusUpdateInput,
  UpdateApplicationResourceInput,
} from '../../shared/schemas/infrastructure'
import { useDatabase, type Database } from '../database/client'
import { DomainError } from '../utils/errors'
import { normalizeOperationError } from '../utils/operation-error'
import {
  validateLocalImageNode,
  validateSecretDelivery,
} from '../services/infrastructure/local-image'
import { validateDeploymentNetwork } from '../services/infrastructure/docker-network'
import {
  applicationBuilds,
  auditLogs,
  infrastructureDatabaseClusters,
  infrastructureDatabaseBackups,
  infrastructureBackupPolicies,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  infrastructureServiceDatabases,
  infrastructureTemplates,
  resourceObservations,
  resourceRoutes,
  resourceSecretReferences,
  resourceVolumes,
  serviceResources,
  services,
} from '../database/schema'
import { createDeploymentDatabase } from './deployment-database'

export interface CreateApplicationRecord {
  resourceId: string
  externalId: string
  idempotencyKey: string
  actorUserId: string
  expiresAt: Date
  input: CreateApplicationResourceInput
}

export interface CreateLifecycleOperationRecord {
  resourceId: string
  action:
    | 'application.start'
    | 'application.stop'
    | 'application.restart'
    | 'application.redeploy'
    | 'application.delete'
  idempotencyKey: string
  actorUserId: string
  expiresAt: Date
}

export interface CreateContainerExecOperationRecord {
  resourceId: string
  command: string
  idempotencyKey: string
  actorUserId: string
  expiresAt: Date
}

export interface UpdateApplicationRecord {
  resourceId: string
  idempotencyKey: string
  actorUserId: string
  expiresAt: Date
  input: UpdateApplicationResourceInput
}

export class NativeInfrastructureRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findOperationByIdempotencyKey(idempotencyKey: string) {
    const [operation] = await this.database
      .select()
      .from(infrastructureOperations)
      .where(eq(infrastructureOperations.idempotencyKey, idempotencyKey))
      .limit(1)
    return operation ?? null
  }

  async createApplication(input: CreateApplicationRecord) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existing) return { operation: existing, replayed: true }

      const [node] = await transaction
        .select({
          id: infrastructureNodes.id,
          capabilities: infrastructureNodes.capabilities,
          imageInventory: infrastructureNodes.imageInventory,
          networkInventory: infrastructureNodes.networkInventory,
        })
        .from(infrastructureNodes)
        .where(
          and(
            eq(infrastructureNodes.id, input.input.nodeId),
            eq(infrastructureNodes.isActive, true),
            eq(infrastructureNodes.isDraining, false),
            inArray(infrastructureNodes.status, ['online', 'degraded']),
            inArray(infrastructureNodes.role, ['deployment', 'hybrid']),
          ),
        )
        .limit(1)
        .for('update')
      if (!node) return null
      validateLocalImageNode(
        input.input.spec.source,
        node.id,
        node.capabilities,
        node.imageInventory,
      )
      validateSecretDelivery(input.input.spec, node.capabilities)
      validateDeploymentNetwork(
        input.input.spec.networkName,
        node.capabilities,
        node.networkInventory,
      )

      const billingServiceId =
        input.input.classification === 'billable' ? input.input.serviceId : undefined
      const [service] = billingServiceId
        ? await transaction
            .select({ id: services.id, customerId: services.customerId })
            .from(services)
            .where(and(eq(services.id, billingServiceId), ne(services.status, 'cancelled')))
            .limit(1)
        : []
      if (billingServiceId && !service) {
        throw DomainError.validation('Service tidak ditemukan atau sudah dibatalkan.')
      }
      if (input.input.customerId && service && input.input.customerId !== service.customerId) {
        throw DomainError.validation('Customer resource berbeda dengan customer Service.')
      }

      const [resource] = await transaction
        .insert(infrastructureResources)
        .values({
          id: input.resourceId,
          nodeId: input.input.nodeId,
          customerId: service?.customerId ?? input.input.customerId,
          externalId: input.externalId,
          kind: 'application',
          name: input.input.name,
          classification: input.input.classification,
          desiredState: input.input.managedDatabase ? 'pending' : 'running',
          desiredRevision: 1,
          imageReference:
            input.input.spec.source.type === 'image' ? input.input.spec.source.reference : null,
          desiredSpec: input.input.spec,
          labels: {
            'oc.managed': 'true',
            'oc.resource-id': input.resourceId,
            'oc.revision': '1',
            ...(input.input.managedDatabase ? { 'oc.deployment-gate': 'database' } : {}),
          },
        })
        .returning()
      if (!resource) throw new Error('Failed to create infrastructure resource.')

      if (service) {
        await transaction.insert(serviceResources).values({
          serviceId: service.id,
          resourceId: resource.id,
          createdBy: input.actorUserId,
        })
      }
      await transaction
        .update(resourceRoutes)
        .set({
          billingGateEnabled: input.input.classification === 'billable',
          updatedAt: new Date(),
        })
        .where(eq(resourceRoutes.resourceId, resource.id))

      for (const volume of input.input.spec.volumes) {
        await transaction.insert(resourceVolumes).values({
          nodeId: input.input.nodeId,
          resourceId: resource.id,
          externalId: `oc-${resource.id}-${volume.name}`,
          name: volume.name,
          mountTarget: volume.mountTarget,
          kind: volume.kind,
          deleteProtection: volume.kind === 'persistent',
        })
      }

      const operation = input.input.managedDatabase
        ? (
            await createDeploymentDatabase(transaction, {
              clusterId: input.input.managedDatabase.clusterId,
              applicationResourceId: resource.id,
              applicationNodeId: input.input.nodeId,
              serviceId: service?.id,
              environmentKey: input.input.managedDatabase.environmentKey,
              networkName: input.input.spec.networkName,
              actorUserId: input.actorUserId,
              idempotencyKey: input.idempotencyKey,
              expiresAt: input.expiresAt,
            })
          ).operation
        : (
            await transaction
              .insert(infrastructureOperations)
              .values({
                nodeId: input.input.nodeId,
                resourceId: resource.id,
                actorUserId: input.actorUserId,
                idempotencyKey: input.idempotencyKey,
                action: 'application.ensure',
                expectedResourceRevision: 1,
                expiresAt: input.expiresAt,
                payload: {
                  resourceId: resource.id,
                  name: resource.name,
                  revision: 1,
                  spec: input.input.spec,
                },
              })
              .returning()
          )[0]
      if (!operation) throw new Error('Failed to create infrastructure operation.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.application.requested',
        entityType: 'infrastructure_resource',
        entityId: resource.id,
        metadata: {
          nodeId: input.input.nodeId,
          operationId: operation.id,
          correlationId: operation.correlationId,
          serviceId: service?.id ?? null,
          managedDatabaseClusterId: input.input.managedDatabase?.clusterId ?? null,
        },
      })
      return { operation, resource, replayed: false }
    })
  }

  async listResources() {
    const rows = await this.database
      .select({
        id: infrastructureResources.id,
        nodeId: infrastructureResources.nodeId,
        nodeName: infrastructureNodes.name,
        customerId: infrastructureResources.customerId,
        serviceId: serviceResources.serviceId,
        templateId: infrastructureResources.templateId,
        templateName: infrastructureTemplates.name,
        templateVersion: infrastructureResources.templateVersion,
        templateCurrentVersion: infrastructureTemplates.version,
        templateDefinition: infrastructureTemplates.definition,
        applicationId: infrastructureResources.applicationId,
        releaseId: infrastructureResources.releaseId,
        releasePolicy: infrastructureResources.releasePolicy,
        externalId: infrastructureResources.externalId,
        kind: infrastructureResources.kind,
        name: infrastructureResources.name,
        classification: infrastructureResources.classification,
        desiredState: infrastructureResources.desiredState,
        observedState: infrastructureResources.observedState,
        desiredRevision: infrastructureResources.desiredRevision,
        observedRevision: infrastructureResources.observedRevision,
        imageReference: infrastructureResources.imageReference,
        imageDigest: infrastructureResources.imageDigest,
        routeHostname: resourceRoutes.hostname,
        routeStatus: resourceRoutes.observedStatus,
        billingGateEnabled: resourceRoutes.billingGateEnabled,
        desiredSpec: infrastructureResources.desiredSpec,
        lastObservedAt: infrastructureResources.lastObservedAt,
        createdAt: infrastructureResources.createdAt,
        updatedAt: infrastructureResources.updatedAt,
      })
      .from(infrastructureResources)
      .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
      .leftJoin(
        infrastructureTemplates,
        eq(infrastructureTemplates.id, infrastructureResources.templateId),
      )
      .leftJoin(resourceRoutes, eq(resourceRoutes.resourceId, infrastructureResources.id))
      .leftJoin(serviceResources, eq(serviceResources.resourceId, infrastructureResources.id))
      .where(isNull(infrastructureResources.deletedAt))
      .orderBy(asc(infrastructureResources.name))

    return rows.map((row) => ({
      ...row,
      lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async listOperations(limit = 100) {
    const rows = await this.database
      .select({
        id: infrastructureOperations.id,
        nodeId: infrastructureOperations.nodeId,
        nodeName: infrastructureNodes.name,
        nodeEnvironment: infrastructureNodes.environment,
        resourceId: infrastructureOperations.resourceId,
        resourceName: infrastructureResources.name,
        resourceKind: infrastructureResources.kind,
        action: infrastructureOperations.action,
        status: infrastructureOperations.status,
        correlationId: infrastructureOperations.correlationId,
        attemptCount: infrastructureOperations.attemptCount,
        maxAttempts: infrastructureOperations.maxAttempts,
        nextAttemptAt: infrastructureOperations.nextAttemptAt,
        expiresAt: infrastructureOperations.expiresAt,
        startedAt: infrastructureOperations.startedAt,
        completedAt: infrastructureOperations.completedAt,
        errorCode: infrastructureOperations.errorCode,
        errorMessage: infrastructureOperations.errorMessage,
        logExcerpt: infrastructureOperations.logExcerpt,
        logUpdatedAt: infrastructureOperations.logUpdatedAt,
        createdAt: infrastructureOperations.createdAt,
        updatedAt: infrastructureOperations.updatedAt,
      })
      .from(infrastructureOperations)
      .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureOperations.nodeId))
      .leftJoin(
        infrastructureResources,
        eq(infrastructureResources.id, infrastructureOperations.resourceId),
      )
      .orderBy(desc(infrastructureOperations.createdAt))
      .limit(limit)

    return rows.map((row) => ({
      ...row,
      normalizedError: normalizeOperationError(row),
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      logUpdatedAt: row.logUpdatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async appendOperationLogs(
    nodeId: string,
    operationId: string,
    input: OperationLogAppendInput,
  ) {
    const now = new Date()
    const excerpt = (
      input.entries
        .map((entry) => {
          const level = entry.level.toUpperCase().padEnd(7)
          return `[${entry.occurredAt}] ${level} ${entry.message.replace(/[\r\n]+/g, ' ')}`
        })
        .join('\n') + '\n'
    ).slice(-64_000)
    const [operation] = await this.database
      .update(infrastructureOperations)
      .set({
        logExcerpt: sql<string>`right(coalesce(${infrastructureOperations.logExcerpt}, ''), 65536 - length(${excerpt})) || ${excerpt}`,
        logUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(infrastructureOperations.id, operationId),
          eq(infrastructureOperations.nodeId, nodeId),
        ),
      )
      .returning({
        id: infrastructureOperations.id,
        logUpdatedAt: infrastructureOperations.logUpdatedAt,
      })
    return operation ?? null
  }

  async forceStopOperation(operationId: string, actorUserId: string) {
    const now = new Date()
    return this.database.transaction(async (transaction) => {
      const [operation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.id, operationId))
        .limit(1)
        .for('update')
      if (!operation) return { reason: 'not_found' as const }
      if (!['queued', 'dispatched', 'running'].includes(operation.status)) {
        return { reason: 'not_active' as const, operation }
      }

      const [cancelled] = await transaction
        .update(infrastructureOperations)
        .set({
          status: 'cancelled',
          completedAt: now,
          errorCode: 'force_stopped',
          errorMessage: 'Operation dihentikan secara paksa oleh administrator.',
          updatedAt: now,
        })
        .where(eq(infrastructureOperations.id, operation.id))
        .returning()
      if (!cancelled) throw new Error('Failed to force stop infrastructure operation.')

      if (operation.action === 'application.build') {
        await transaction
          .update(applicationBuilds)
          .set({
            status: 'cancelled',
            errorCode: 'force_stopped',
            errorMessage: 'Build dihentikan secara paksa oleh administrator.',
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(applicationBuilds.operationId, operation.id))
      }

      if (operation.action.startsWith('application.') && operation.resourceId) {
        const [resource] = await transaction
          .select({ observedState: infrastructureResources.observedState })
          .from(infrastructureResources)
          .where(eq(infrastructureResources.id, operation.resourceId))
          .limit(1)
        if (resource) {
          const desiredState = ['running', 'stopped', 'degraded'].includes(resource.observedState)
            ? resource.observedState
            : 'failed'
          await transaction
            .update(infrastructureResources)
            .set({ desiredState, updatedAt: now })
            .where(eq(infrastructureResources.id, operation.resourceId))
        }
      }

      if (operation.action === 'database.cluster.activate') {
        await transaction
          .update(infrastructureDatabaseClusters)
          .set({
            status: 'offline',
            isActive: false,
            lastError: 'Aktivasi dihentikan secara paksa oleh administrator.',
            updatedAt: now,
          })
          .where(eq(infrastructureDatabaseClusters.activationOperationId, operation.id))
      }

      if (operation.action === 'database.service.ensure') {
        const [allocation] = await transaction
          .update(infrastructureServiceDatabases)
          .set({
            status: 'failed',
            lastError: 'Provisioning dihentikan secara paksa oleh administrator.',
            updatedAt: now,
          })
          .where(eq(infrastructureServiceDatabases.provisioningOperationId, operation.id))
          .returning({
            id: infrastructureServiceDatabases.id,
            applicationResourceId: infrastructureServiceDatabases.applicationResourceId,
          })
        if (allocation) {
          await transaction
            .update(infrastructureResources)
            .set({ desiredState: 'failed', updatedAt: now })
            .where(eq(infrastructureResources.id, allocation.applicationResourceId))
        }
      }

      if (['route.configure', 'route.delete'].includes(operation.action)) {
        const routeId =
          typeof operation.payload.routeId === 'string' ? operation.payload.routeId : null
        if (routeId) {
          await transaction
            .update(resourceRoutes)
            .set({
              desiredStatus: 'failed',
              observedStatus: 'failed',
              lastError: 'Konfigurasi route dihentikan secara paksa oleh administrator.',
              lastObservedAt: now,
              updatedAt: now,
            })
            .where(eq(resourceRoutes.id, routeId))
        }
      }

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.operation.force-stopped',
        entityType: 'infrastructure_operation',
        entityId: operation.id,
        beforeData: { status: operation.status },
        afterData: { status: 'cancelled' },
        metadata: {
          nodeId: operation.nodeId,
          resourceId: operation.resourceId,
          operationAction: operation.action,
          correlationId: operation.correlationId,
        },
      })

      return { operation: cancelled, previousStatus: operation.status }
    })
  }

  async updateApplication(input: UpdateApplicationRecord) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existing) return { operation: existing, replayed: true }

      const [resource] = await transaction
        .select()
        .from(infrastructureResources)
        .where(
          and(
            eq(infrastructureResources.id, input.resourceId),
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!resource) return null

      const currentNetworkName =
        typeof resource.desiredSpec.networkName === 'string'
          ? resource.desiredSpec.networkName
          : 'oc-private'
      if (input.input.spec.networkName !== currentNetworkName) {
        throw DomainError.validation(
          'Docker network resource yang sudah dibuat tidak dapat dipindah. Buat deployment baru untuk mengganti network.',
        )
      }

      const [node] = await transaction
        .select({
          capabilities: infrastructureNodes.capabilities,
          imageInventory: infrastructureNodes.imageInventory,
          networkInventory: infrastructureNodes.networkInventory,
        })
        .from(infrastructureNodes)
        .where(eq(infrastructureNodes.id, resource.nodeId))
        .limit(1)
      validateLocalImageNode(
        input.input.spec.source,
        resource.nodeId,
        node?.capabilities ?? [],
        node?.imageInventory,
      )
      validateSecretDelivery(input.input.spec, node?.capabilities ?? [])
      validateDeploymentNetwork(
        input.input.spec.networkName,
        node?.capabilities ?? [],
        node?.networkInventory ?? [],
      )
      const billingServiceId =
        input.input.classification === 'billable' ? input.input.serviceId : undefined
      const [service] = billingServiceId
        ? await transaction
            .select({ id: services.id, customerId: services.customerId })
            .from(services)
            .where(and(eq(services.id, billingServiceId), ne(services.status, 'cancelled')))
            .limit(1)
        : []
      if (billingServiceId && !service) {
        throw DomainError.validation('Service tidak ditemukan atau sudah dibatalkan.')
      }
      const revision = resource.desiredRevision + 1
      const [updatedResource] = await transaction
        .update(infrastructureResources)
        .set({
          name: input.input.name,
          customerId: service?.customerId ?? resource.customerId,
          classification: input.input.classification,
          desiredState: 'running',
          desiredRevision: revision,
          imageReference:
            input.input.spec.source.type === 'image' ? input.input.spec.source.reference : null,
          desiredSpec: input.input.spec,
          updatedAt: new Date(),
        })
        .where(eq(infrastructureResources.id, resource.id))
        .returning()
      if (!updatedResource) throw new Error('Failed to update infrastructure resource.')

      await transaction
        .delete(serviceResources)
        .where(eq(serviceResources.resourceId, resource.id))
      if (service) {
        await transaction.insert(serviceResources).values({
          serviceId: service.id,
          resourceId: resource.id,
          createdBy: input.actorUserId,
        })
      }

      for (const volume of input.input.spec.volumes) {
        const externalId = `oc-${resource.id}-${volume.name}`
        await transaction
          .insert(resourceVolumes)
          .values({
            nodeId: resource.nodeId,
            resourceId: resource.id,
            externalId,
            name: volume.name,
            mountTarget: volume.mountTarget,
            kind: volume.kind,
            deleteProtection: volume.kind === 'persistent',
          })
          .onConflictDoUpdate({
            target: [resourceVolumes.nodeId, resourceVolumes.externalId],
            set: {
              name: volume.name,
              mountTarget: volume.mountTarget,
              kind: volume.kind,
              deleteProtection: volume.kind === 'persistent',
              updatedAt: new Date(),
            },
          })
      }

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          nodeId: resource.nodeId,
          resourceId: resource.id,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: 'application.redeploy',
          expectedResourceRevision: revision,
          expiresAt: input.expiresAt,
          payload: {
            resourceId: resource.id,
            name: input.input.name,
            revision,
            spec: input.input.spec,
          },
        })
        .returning()
      if (!operation) throw new Error('Failed to create redeploy operation.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.application.updated',
        entityType: 'infrastructure_resource',
        entityId: resource.id,
        metadata: {
          operationId: operation.id,
          correlationId: operation.correlationId,
          revision,
          serviceId: service?.id ?? null,
        },
      })
      return { operation, resource: updatedResource, replayed: false }
    })
  }

  async createLifecycleOperation(input: CreateLifecycleOperationRecord) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existing) return { operation: existing, replayed: true }

      const [resource] = await transaction
        .select()
        .from(infrastructureResources)
        .where(
          and(
            eq(infrastructureResources.id, input.resourceId),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!resource) return null

      const desiredState =
        input.action === 'application.stop'
          ? 'stopped'
          : input.action === 'application.delete'
            ? 'deleting'
            : 'running'
      const revision =
        input.action === 'application.redeploy' || input.action === 'application.delete'
          ? resource.desiredRevision + 1
          : resource.desiredRevision
      await transaction
        .update(infrastructureResources)
        .set({ desiredState, desiredRevision: revision, updatedAt: new Date() })
        .where(eq(infrastructureResources.id, resource.id))

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          nodeId: resource.nodeId,
          resourceId: resource.id,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: input.action,
          expectedResourceRevision: revision,
          expiresAt: input.expiresAt,
          payload:
            input.action === 'application.redeploy'
              ? {
                  resourceId: resource.id,
                  name: resource.name,
                  kind: resource.kind,
                  revision,
                  spec: resource.desiredSpec,
                }
              : { resourceId: resource.id, revision },
        })
        .returning()
      if (!operation) throw new Error('Failed to create lifecycle operation.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: 'infrastructure_resource',
        entityId: resource.id,
        metadata: { operationId: operation.id, correlationId: operation.correlationId },
      })
      return { operation, replayed: false }
    })
  }

  async createContainerExecOperation(input: CreateContainerExecOperationRecord) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existing) return { operation: existing, replayed: true }

      const [target] = await transaction
        .select({
          resourceId: infrastructureResources.id,
          resourceName: infrastructureResources.name,
          nodeId: infrastructureResources.nodeId,
          observedState: infrastructureResources.observedState,
          desiredRevision: infrastructureResources.desiredRevision,
          observedRevision: infrastructureResources.observedRevision,
          nodeStatus: infrastructureNodes.status,
          nodeActive: infrastructureNodes.isActive,
          nodeDraining: infrastructureNodes.isDraining,
          nodeLastHeartbeatAt: infrastructureNodes.lastHeartbeatAt,
          capabilities: infrastructureNodes.capabilities,
        })
        .from(infrastructureResources)
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(
          and(
            eq(infrastructureResources.id, input.resourceId),
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .limit(1)
      if (!target) return { reason: 'not_found' as const }
      if (
        target.observedState !== 'running' ||
        target.desiredRevision !== target.observedRevision
      ) {
        return { reason: 'not_running' as const }
      }
      if (
        !target.nodeActive ||
        target.nodeDraining ||
        !['online', 'degraded'].includes(target.nodeStatus) ||
        !target.nodeLastHeartbeatAt ||
        target.nodeLastHeartbeatAt.getTime() < Date.now() - 90_000
      ) {
        return { reason: 'node_unavailable' as const }
      }
      if (!target.capabilities.includes('container-exec')) {
        return { reason: 'unsupported' as const }
      }

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          nodeId: target.nodeId,
          resourceId: target.resourceId,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: 'container.exec',
          maxAttempts: 1,
          expiresAt: input.expiresAt,
          payload: { resourceId: target.resourceId, command: input.command },
        })
        .returning()
      if (!operation) throw new Error('Failed to create container exec operation.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.container.exec.requested',
        entityType: 'infrastructure_resource',
        entityId: target.resourceId,
        metadata: { operationId: operation.id, nodeId: target.nodeId },
      })
      return { operation, replayed: false }
    })
  }

  async findContainerExecOperation(resourceId: string, operationId: string) {
    const [operation] = await this.database
      .select({
        id: infrastructureOperations.id,
        status: infrastructureOperations.status,
        result: infrastructureOperations.result,
        errorCode: infrastructureOperations.errorCode,
        errorMessage: infrastructureOperations.errorMessage,
        createdAt: infrastructureOperations.createdAt,
        completedAt: infrastructureOperations.completedAt,
      })
      .from(infrastructureOperations)
      .where(
        and(
          eq(infrastructureOperations.id, operationId),
          eq(infrastructureOperations.resourceId, resourceId),
          eq(infrastructureOperations.action, 'container.exec'),
        ),
      )
      .limit(1)
    if (!operation) return null
    return {
      ...operation,
      createdAt: operation.createdAt.toISOString(),
      completedAt: operation.completedAt?.toISOString() ?? null,
    }
  }

  async claimNextOperation(nodeId: string, workerId: string) {
    const now = new Date()
    return this.database.transaction(async (transaction) => {
      const expiredOperations = await transaction
        .update(infrastructureOperations)
        .set({ status: 'expired', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(infrastructureOperations.nodeId, nodeId),
            inArray(infrastructureOperations.status, ['queued', 'dispatched']),
            lte(infrastructureOperations.expiresAt, now),
          ),
        )
        .returning({ id: infrastructureOperations.id, action: infrastructureOperations.action })

      const expiredExecOperationIds = expiredOperations
        .filter((operation) => operation.action === 'container.exec')
        .map((operation) => operation.id)
      if (expiredExecOperationIds.length > 0) {
        await transaction
          .update(infrastructureOperations)
          .set({ payload: {} })
          .where(inArray(infrastructureOperations.id, expiredExecOperationIds))
      }

      const expiredBuildOperationIds = expiredOperations
        .filter((operation) => operation.action === 'application.build')
        .map((operation) => operation.id)
      if (expiredBuildOperationIds.length > 0) {
        await transaction
          .update(applicationBuilds)
          .set({
            status: 'failed',
            errorCode: 'build_operation_expired',
            errorMessage: 'Build kedaluwarsa sebelum dijalankan oleh builder node.',
            completedAt: now,
            updatedAt: now,
          })
          .where(inArray(applicationBuilds.operationId, expiredBuildOperationIds))
      }

      if (
        expiredOperations.some((operation) =>
          ['agent.upgrade', 'agent.rollback'].includes(operation.action),
        )
      ) {
        await transaction
          .update(infrastructureNodes)
          .set({
            agentUpdateStatus: 'failed',
            agentLastUpdateAt: now,
            agentLastUpdateError: 'Operation agent kedaluwarsa sebelum dijalankan.',
            updatedAt: now,
          })
          .where(eq(infrastructureNodes.id, nodeId))
      }

      const [operation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(
          and(
            eq(infrastructureOperations.nodeId, nodeId),
            eq(infrastructureOperations.status, 'queued'),
            lte(infrastructureOperations.nextAttemptAt, now),
            lt(infrastructureOperations.attemptCount, infrastructureOperations.maxAttempts),
          ),
        )
        .orderBy(asc(infrastructureOperations.createdAt))
        .limit(1)
        .for('update', { skipLocked: true })
      if (!operation) return null

      const [claimed] = await transaction
        .update(infrastructureOperations)
        .set({
          status: 'dispatched',
          attemptCount: operation.attemptCount + 1,
          lockedAt: now,
          lockedBy: workerId,
          updatedAt: now,
        })
        .where(eq(infrastructureOperations.id, operation.id))
        .returning()
      return claimed ?? null
    })
  }

  async findOperationForNode(nodeId: string, operationId: string) {
    const [operation] = await this.database
      .select()
      .from(infrastructureOperations)
      .where(
        and(
          eq(infrastructureOperations.id, operationId),
          eq(infrastructureOperations.nodeId, nodeId),
        ),
      )
      .limit(1)
    return operation ?? null
  }

  async listExpiredExecutingOperationIds(nodeId: string, now = new Date()) {
    return this.database
      .select({ id: infrastructureOperations.id })
      .from(infrastructureOperations)
      .where(
        and(
          eq(infrastructureOperations.nodeId, nodeId),
          inArray(infrastructureOperations.status, ['dispatched', 'running']),
          lte(infrastructureOperations.expiresAt, now),
        ),
      )
  }

  async listCancelledExecutingOperationIds(nodeId: string) {
    return this.database
      .select({ id: infrastructureOperations.id })
      .from(infrastructureOperations)
      .where(
        and(
          eq(infrastructureOperations.nodeId, nodeId),
          eq(infrastructureOperations.status, 'cancelled'),
          isNotNull(infrastructureOperations.lockedAt),
        ),
      )
      .orderBy(desc(infrastructureOperations.updatedAt))
      .limit(100)
  }

  async recordOperationStatus(
    nodeId: string,
    operationId: string,
    input: OperationStatusUpdateInput,
    nextAttemptAt?: Date,
  ) {
    const now = new Date()
    const billingGateInternalUrl = String(useRuntimeConfig().billingGateInternalUrl || '')
    return this.database.transaction(async (transaction) => {
      const [operation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(
          and(
            eq(infrastructureOperations.id, operationId),
            eq(infrastructureOperations.nodeId, nodeId),
          ),
        )
        .limit(1)
        .for('update')
      if (!operation) return null

      let normalizedMissingPendingDelete = false
      if (
        operation.action === 'application.delete' &&
        operation.resourceId &&
        input.status === 'failed' &&
        input.errorCode === 'resource_not_found'
      ) {
        const [resource] = await transaction
          .select({ externalId: infrastructureResources.externalId })
          .from(infrastructureResources)
          .where(eq(infrastructureResources.id, operation.resourceId))
          .limit(1)
        normalizedMissingPendingDelete = resource?.externalId.startsWith('pending:') === true
      }

      const reportedStatus = normalizedMissingPendingDelete ? 'succeeded' : input.status
      const operationResult = normalizedMissingPendingDelete
        ? {
            ...(input.result ?? {}),
            externalId: `oc-${operation.resourceId?.replaceAll('-', '')}`,
            alreadyAbsent: true,
            normalizedFromError: 'resource_not_found',
          }
        : input.result
      const shouldRetry =
        reportedStatus === 'failed' &&
        input.retryable &&
        operation.attemptCount < operation.maxAttempts
      const status = shouldRetry ? 'queued' : reportedStatus
      const terminal = status === 'succeeded' || status === 'failed'

      const [updated] = await transaction
        .update(infrastructureOperations)
        .set({
          status,
          result: operationResult,
          payload:
            terminal && operation.action === 'container.exec'
              ? { resourceId: operation.resourceId }
              : operation.payload,
          nextAttemptAt: shouldRetry && nextAttemptAt ? nextAttemptAt : operation.nextAttemptAt,
          lockedAt: shouldRetry ? null : operation.lockedAt,
          lockedBy: shouldRetry ? null : operation.lockedBy,
          startedAt:
            input.status === 'running' ? (operation.startedAt ?? now) : operation.startedAt,
          completedAt: terminal ? now : null,
          errorCode: normalizedMissingPendingDelete ? null : (input.errorCode ?? null),
          errorMessage: normalizedMissingPendingDelete ? null : (input.errorMessage ?? null),
          updatedAt: now,
        })
        .where(eq(infrastructureOperations.id, operation.id))
        .returning()

      if (operation.action === 'gateway.ensure') {
        const gatewayStatus =
          status === 'succeeded'
            ? ('healthy' as const)
            : status === 'failed'
              ? ('failed' as const)
              : ('installing' as const)
        await transaction
          .update(infrastructureNodes)
          .set({
            gatewayStatus,
            gatewayVersion:
              typeof input.result?.image === 'string' ? input.result.image : undefined,
            gatewayContainerId:
              typeof input.result?.containerId === 'string' ? input.result.containerId : undefined,
            gatewayLastObservedAt: now,
            gatewayLastError: gatewayStatus === 'healthy' ? null : (input.errorMessage ?? null),
            updatedAt: now,
          })
          .where(eq(infrastructureNodes.id, nodeId))
      }

      if (['agent.upgrade', 'agent.rollback'].includes(operation.action)) {
        const updateStatus =
          status === 'succeeded'
            ? ('succeeded' as const)
            : status === 'failed'
              ? ('failed' as const)
              : ('staging' as const)
        const previousVersion =
          typeof input.result?.previousVersion === 'string' && input.result.previousVersion.trim()
            ? input.result.previousVersion
            : undefined
        await transaction
          .update(infrastructureNodes)
          .set({
            previousAgentVersion: previousVersion,
            agentUpdateStatus: updateStatus,
            agentLastUpdateAt: status === 'succeeded' || status === 'failed' ? now : undefined,
            agentLastUpdateError: status === 'failed' ? (input.errorMessage ?? null) : null,
            updatedAt: now,
          })
          .where(eq(infrastructureNodes.id, nodeId))

        if (status === 'succeeded' || status === 'failed') {
          await transaction.insert(auditLogs).values({
            actorUserId: operation.actorUserId,
            action:
              status === 'succeeded'
                ? `infrastructure.${operation.action}.succeeded`
                : `infrastructure.${operation.action}.failed`,
            entityType: 'infrastructure_node',
            entityId: nodeId,
            metadata: {
              operationId: operation.id,
              targetVersion: operation.payload.version ?? null,
              previousVersion: previousVersion ?? null,
              errorCode: input.errorCode ?? null,
            },
          })
        }
      }

      if (operation.action === 'image.delete' && terminal) {
        const imageId =
          typeof operation.payload.imageId === 'string' ? operation.payload.imageId : null
        if (imageId && status === 'succeeded') {
          const [node] = await transaction
            .select({ imageInventory: infrastructureNodes.imageInventory })
            .from(infrastructureNodes)
            .where(eq(infrastructureNodes.id, nodeId))
            .limit(1)
            .for('update')
          if (node) {
            await transaction
              .update(infrastructureNodes)
              .set({
                imageInventory: node.imageInventory.filter((image) => image.id !== imageId),
                updatedAt: now,
              })
              .where(eq(infrastructureNodes.id, nodeId))
          }
        }
        await transaction.insert(auditLogs).values({
          actorUserId: operation.actorUserId,
          action:
            status === 'succeeded'
              ? 'infrastructure.image.delete.succeeded'
              : 'infrastructure.image.delete.failed',
          entityType: 'infrastructure_node',
          entityId: nodeId,
          metadata: {
            operationId: operation.id,
            imageId,
            errorCode: input.errorCode ?? null,
          },
        })
      }

      if (operation.action === 'container.exec' && terminal) {
        await transaction.insert(auditLogs).values({
          actorUserId: operation.actorUserId,
          action:
            status === 'succeeded'
              ? 'infrastructure.container.exec.succeeded'
              : 'infrastructure.container.exec.failed',
          entityType: 'infrastructure_resource',
          entityId: operation.resourceId,
          metadata: {
            operationId: operation.id,
            exitCode: typeof input.result?.exitCode === 'number' ? input.result.exitCode : null,
            outputTruncated: input.result?.truncated === true,
            errorCode: input.errorCode ?? null,
          },
        })
      }

      if (
        status === 'succeeded' &&
        operation.resourceId &&
        operation.action.startsWith('application.')
      ) {
        const state = operationState(operation.action)
        const revision = input.observedRevision ?? operation.expectedResourceRevision ?? 0
        await transaction
          .update(infrastructureResources)
          .set({
            observedState: state,
            observedRevision: revision,
            externalId:
              typeof operationResult?.externalId === 'string'
                ? operationResult.externalId
                : undefined,
            imageDigest:
              typeof operationResult?.imageDigest === 'string'
                ? operationResult.imageDigest
                : undefined,
            lastObservedAt: now,
            deletedAt: state === 'deleted' ? now : null,
            updatedAt: now,
          })
          .where(eq(infrastructureResources.id, operation.resourceId))

        await transaction.insert(resourceObservations).values({
          nodeId,
          resourceId: operation.resourceId,
          observedRevision: revision,
          state,
          snapshot: operationResult ?? {},
          observedAt: now,
        })

        if (['application.ensure', 'application.redeploy'].includes(operation.action)) {
          const operationSpec =
            operation.payload.spec && typeof operation.payload.spec === 'object'
              ? (operation.payload.spec as Record<string, unknown>)
              : null
          const networkName =
            typeof operationSpec?.networkName === 'string'
              ? operationSpec.networkName
              : 'oc-private'
          const routes = await transaction
            .select()
            .from(resourceRoutes)
            .where(eq(resourceRoutes.resourceId, operation.resourceId))
          for (const route of routes) {
            if (route.desiredStatus === 'disabled') continue
            await transaction
              .insert(infrastructureOperations)
              .values({
                nodeId,
                resourceId: operation.resourceId,
                actorUserId: operation.actorUserId,
                idempotencyKey: `route.configure:${route.id}:${revision}`,
                correlationId: operation.correlationId,
                action: 'route.configure',
                expiresAt: new Date(now.getTime() + 15 * 60_000),
                payload: {
                  routeId: route.id,
                  resourceId: operation.resourceId,
                  hostname: route.hostname,
                  targetPort: route.targetPort,
                  billingGateEnabled: route.billingGateEnabled,
                  billingGateUrl: route.billingGateEnabled ? billingGateInternalUrl : undefined,
                  networkName,
                },
              })
              .onConflictDoNothing({ target: infrastructureOperations.idempotencyKey })
            await transaction
              .update(resourceRoutes)
              .set({ desiredStatus: 'configuring', updatedAt: now })
              .where(eq(resourceRoutes.id, route.id))
          }
        }
        if (operation.action === 'application.delete') {
          const routes = await transaction
            .select({ id: resourceRoutes.id })
            .from(resourceRoutes)
            .where(eq(resourceRoutes.resourceId, operation.resourceId))
          for (const route of routes) {
            await transaction
              .insert(infrastructureOperations)
              .values({
                nodeId,
                resourceId: operation.resourceId,
                actorUserId: operation.actorUserId,
                idempotencyKey: `route.delete:${route.id}:${revision}`,
                correlationId: operation.correlationId,
                action: 'route.delete',
                expiresAt: new Date(now.getTime() + 15 * 60_000),
                payload: { routeId: route.id },
              })
              .onConflictDoNothing({ target: infrastructureOperations.idempotencyKey })
            await transaction
              .update(resourceRoutes)
              .set({ desiredStatus: 'disabled', observedStatus: 'configuring', updatedAt: now })
              .where(eq(resourceRoutes.id, route.id))
          }
        }
      }
      if (
        ['route.configure', 'route.delete'].includes(operation.action) &&
        (status === 'succeeded' || status === 'failed')
      ) {
        const routeId =
          typeof operation.payload.routeId === 'string' ? operation.payload.routeId : null
        if (routeId) {
          if (operation.action === 'route.delete' && status === 'succeeded') {
            await transaction.delete(resourceRoutes).where(eq(resourceRoutes.id, routeId))
          } else {
            await transaction
              .update(resourceRoutes)
              .set({
                desiredStatus: status === 'succeeded' ? 'active' : 'failed',
                observedStatus: status === 'succeeded' ? 'active' : 'failed',
                lastError: status === 'succeeded' ? null : (input.errorMessage ?? 'Route gagal.'),
                lastObservedAt: now,
                updatedAt: now,
              })
              .where(eq(resourceRoutes.id, routeId))
          }
        }
      }
      if (
        operation.action === 'database.cluster.activate' &&
        (status === 'succeeded' || status === 'failed')
      ) {
        const succeeded = status === 'succeeded'
        const [cluster] = await transaction
          .update(infrastructureDatabaseClusters)
          .set({
            status: succeeded ? 'active' : 'offline',
            isActive: succeeded,
            lastError: succeeded ? null : (input.errorMessage ?? 'Preflight cluster gagal.'),
            activatedAt: succeeded ? now : null,
            updatedAt: now,
          })
          .where(eq(infrastructureDatabaseClusters.activationOperationId, operation.id))
          .returning({ id: infrastructureDatabaseClusters.id })
        if (cluster) {
          await transaction.insert(auditLogs).values({
            actorUserId: operation.actorUserId,
            action: succeeded
              ? 'infrastructure.database-cluster.activated'
              : 'infrastructure.database-cluster.activation-failed',
            entityType: 'infrastructure_database_cluster',
            entityId: cluster.id,
            metadata: { operationId: operation.id, errorCode: input.errorCode ?? null },
          })
        }
      }
      if (
        operation.action === 'database.service.ensure' &&
        (status === 'succeeded' || status === 'failed')
      ) {
        const succeeded = status === 'succeeded'
        const [allocation] = await transaction
          .select({
            id: infrastructureServiceDatabases.id,
            serviceId: infrastructureServiceDatabases.serviceId,
            applicationResourceId: infrastructureServiceDatabases.applicationResourceId,
            environmentKey: infrastructureServiceDatabases.environmentKey,
            connectionUriEncrypted: infrastructureServiceDatabases.connectionUriEncrypted,
          })
          .from(infrastructureServiceDatabases)
          .where(eq(infrastructureServiceDatabases.provisioningOperationId, operation.id))
          .limit(1)
          .for('update')

        if (allocation) {
          let redeployOperationId: string | null = null
          if (succeeded) {
            const [application] = await transaction
              .select()
              .from(infrastructureResources)
              .where(
                and(
                  eq(infrastructureResources.id, allocation.applicationResourceId),
                  eq(infrastructureResources.kind, 'application'),
                  isNull(infrastructureResources.deletedAt),
                ),
              )
              .limit(1)
              .for('update')
            if (!application)
              throw new Error('Application resource for database allocation is missing.')

            const applicationLabels = application.labels as Record<string, string>
            const databaseGated = applicationLabels['oc.deployment-gate'] === 'database'

            const [existingSecret] = await transaction
              .select()
              .from(resourceSecretReferences)
              .where(
                and(
                  eq(resourceSecretReferences.resourceId, application.id),
                  eq(resourceSecretReferences.environmentKey, allocation.environmentKey),
                ),
              )
              .limit(1)
            const secretId = existingSecret?.id ?? randomUUID()
            const secretVersion = (existingSecret?.version ?? 0) + 1
            const secretReference = `managed://${secretId}@${secretVersion}`
            if (existingSecret) {
              await transaction
                .update(resourceSecretReferences)
                .set({
                  secretReference,
                  encryptedValue: allocation.connectionUriEncrypted,
                  version: secretVersion,
                  updatedAt: now,
                })
                .where(eq(resourceSecretReferences.id, existingSecret.id))
            } else {
              const applicationSpec = application.desiredSpec as {
                secretDelivery?: 'files' | 'environment'
              }
              await transaction.insert(resourceSecretReferences).values({
                id: secretId,
                resourceId: application.id,
                environmentKey: allocation.environmentKey,
                secretReference,
                encryptedValue: allocation.connectionUriEncrypted,
                delivery:
                  applicationSpec.secretDelivery === 'environment' ? 'environment' : 'file',
                version: secretVersion,
              })
            }

            const spec = application.desiredSpec as {
              secretReferences?: Record<string, string>
              [key: string]: unknown
            }
            const desiredSpec = {
              ...spec,
              secretReferences: {
                ...(spec.secretReferences ?? {}),
                [allocation.environmentKey]: secretReference,
              },
            }
            const revision = databaseGated
              ? application.desiredRevision
              : application.desiredRevision + 1
            const { ['oc.deployment-gate']: _deploymentGate, ...labels } = applicationLabels
            await transaction
              .update(infrastructureResources)
              .set({
                desiredSpec,
                desiredState: 'running',
                desiredRevision: revision,
                labels,
                updatedAt: now,
              })
              .where(eq(infrastructureResources.id, application.id))

            const [redeployOperation] = await transaction
              .insert(infrastructureOperations)
              .values({
                nodeId: application.nodeId,
                resourceId: application.id,
                actorUserId: operation.actorUserId,
                idempotencyKey: databaseGated
                  ? `application.ensure:${application.id}:${revision}`
                  : `service-database:${allocation.id}:application-redeploy:${revision}`,
                correlationId: operation.correlationId,
                action: databaseGated ? 'application.ensure' : 'application.redeploy',
                expectedResourceRevision: revision,
                expiresAt: new Date(now.getTime() + 15 * 60_000),
                payload: {
                  resourceId: application.id,
                  name: application.name,
                  kind: application.kind,
                  revision,
                  spec: desiredSpec,
                },
              })
              .returning({ id: infrastructureOperations.id })
            if (!redeployOperation) throw new Error('Failed to schedule application redeploy.')
            redeployOperationId = redeployOperation.id
          } else {
            const [application] = await transaction
              .select({
                id: infrastructureResources.id,
                labels: infrastructureResources.labels,
              })
              .from(infrastructureResources)
              .where(eq(infrastructureResources.id, allocation.applicationResourceId))
              .limit(1)
            if (
              application &&
              (application.labels as Record<string, string>)['oc.deployment-gate'] === 'database'
            ) {
              await transaction
                .update(infrastructureResources)
                .set({ desiredState: 'failed', updatedAt: now })
                .where(eq(infrastructureResources.id, application.id))
            }
          }

          await transaction
            .update(infrastructureServiceDatabases)
            .set({
              status: succeeded ? 'active' : 'failed',
              lastError: succeeded ? null : (input.errorMessage ?? 'Provisioning database gagal.'),
              provisionedAt: succeeded ? now : null,
              redeployOperationId,
              updatedAt: now,
            })
            .where(eq(infrastructureServiceDatabases.id, allocation.id))

          await transaction.insert(auditLogs).values({
            actorUserId: operation.actorUserId,
            action: succeeded
              ? 'infrastructure.service-database.provisioned'
              : 'infrastructure.service-database.provisioning-failed',
            entityType: 'infrastructure_service_database',
            entityId: allocation.id,
            metadata: {
              serviceId: allocation.serviceId,
              operationId: operation.id,
              redeployOperationId,
              errorCode: input.errorCode ?? null,
            },
          })
        }
      }
      if (
        operation.action === 'database.backup.create' &&
        ['running', 'succeeded', 'failed'].includes(status)
      ) {
        const succeeded = status === 'succeeded'
        const result = input.result ?? {}
        const sizeValue = typeof result.sizeBytes === 'string' ? result.sizeBytes : null
        const [backup] = await transaction
          .update(infrastructureDatabaseBackups)
          .set({
            status: status === 'running' ? 'creating' : succeeded ? 'available' : 'failed',
            storagePath:
              succeeded && typeof result.storagePath === 'string' ? result.storagePath : undefined,
            checksumSha256:
              succeeded && typeof result.checksumSha256 === 'string'
                ? result.checksumSha256
                : undefined,
            sizeBytes: succeeded && sizeValue ? BigInt(sizeValue) : undefined,
            lastError:
              status === 'failed' ? (input.errorMessage ?? 'Backup database gagal.') : null,
            completedAt: succeeded ? now : undefined,
            updatedAt: now,
          })
          .where(eq(infrastructureDatabaseBackups.createOperationId, operation.id))
          .returning({
            id: infrastructureDatabaseBackups.id,
            policyId: infrastructureDatabaseBackups.policyId,
            serviceDatabaseId: infrastructureDatabaseBackups.serviceDatabaseId,
          })
        if (backup && status !== 'running') {
          await transaction.insert(auditLogs).values({
            actorUserId: operation.actorUserId,
            action: succeeded
              ? 'infrastructure.database-backup.completed'
              : 'infrastructure.database-backup.failed',
            entityType: 'infrastructure_database_backup',
            entityId: backup.id,
            metadata: { operationId: operation.id, errorCode: input.errorCode ?? null },
          })
        }
        if (backup && succeeded && backup.policyId) {
          const [policy] = await transaction
            .select({ retentionCount: infrastructureBackupPolicies.retentionCount })
            .from(infrastructureBackupPolicies)
            .where(eq(infrastructureBackupPolicies.id, backup.policyId))
            .limit(1)
          if (policy) {
            const expired = await transaction
              .select({
                id: infrastructureDatabaseBackups.id,
                serviceDatabaseId: infrastructureDatabaseBackups.serviceDatabaseId,
                storageTargetId: infrastructureDatabaseBackups.storageTargetId,
                objectKey: infrastructureDatabaseBackups.objectKey,
              })
              .from(infrastructureDatabaseBackups)
              .where(
                and(
                  eq(infrastructureDatabaseBackups.policyId, backup.policyId),
                  eq(infrastructureDatabaseBackups.status, 'available'),
                  isNull(infrastructureDatabaseBackups.deletedAt),
                ),
              )
              .orderBy(desc(infrastructureDatabaseBackups.createdAt))
              .offset(policy.retentionCount)
            for (const item of expired) {
              const deleteId = randomUUID()
              await transaction
                .insert(infrastructureOperations)
                .values({
                  id: deleteId,
                  nodeId: operation.nodeId,
                  resourceId: operation.resourceId,
                  actorUserId: operation.actorUserId,
                  idempotencyKey: `database-backup-retention:${item.id}`,
                  action: 'database.backup.delete',
                  expiresAt: new Date(now.getTime() + 60 * 60_000),
                  payload: {
                    backupId: item.id,
                    allocationId: item.serviceDatabaseId,
                    storageTargetId: item.storageTargetId,
                    objectStorage:
                      item.storageTargetId && item.objectKey && operation.payload.objectStorage
                        ? { ...operation.payload.objectStorage, objectKey: item.objectKey }
                        : undefined,
                  },
                })
                .onConflictDoNothing({ target: infrastructureOperations.idempotencyKey })
              await transaction
                .update(infrastructureDatabaseBackups)
                .set({ status: 'deleting', expiresAt: now, updatedAt: now })
                .where(eq(infrastructureDatabaseBackups.id, item.id))
            }
          }
        }
      }
      if (
        operation.action === 'database.backup.restore' &&
        (status === 'succeeded' || status === 'failed')
      ) {
        const succeeded = status === 'succeeded'
        const [backup] = await transaction
          .update(infrastructureDatabaseBackups)
          .set({
            status: 'available',
            lastError: succeeded ? null : (input.errorMessage ?? 'Restore database gagal.'),
            restoredAt: succeeded ? now : undefined,
            updatedAt: now,
          })
          .where(eq(infrastructureDatabaseBackups.restoreOperationId, operation.id))
          .returning({ id: infrastructureDatabaseBackups.id })
        if (backup) {
          await transaction.insert(auditLogs).values({
            actorUserId: operation.actorUserId,
            action: succeeded
              ? 'infrastructure.database-backup.restored'
              : 'infrastructure.database-backup.restore-failed',
            entityType: 'infrastructure_database_backup',
            entityId: backup.id,
            metadata: { operationId: operation.id, errorCode: input.errorCode ?? null },
          })
        }
      }
      if (
        operation.action === 'database.backup.delete' &&
        (status === 'succeeded' || status === 'failed')
      ) {
        const backupId =
          typeof operation.payload.backupId === 'string' ? operation.payload.backupId : null
        if (backupId) {
          await transaction
            .update(infrastructureDatabaseBackups)
            .set({
              status: status === 'succeeded' ? 'deleted' : 'failed',
              deletedAt: status === 'succeeded' ? now : null,
              lastError:
                status === 'failed' ? (input.errorMessage ?? 'Retensi backup gagal.') : null,
              updatedAt: now,
            })
            .where(eq(infrastructureDatabaseBackups.id, backupId))
          await transaction.insert(auditLogs).values({
            actorUserId: operation.actorUserId,
            action:
              status === 'succeeded'
                ? 'infrastructure.database-backup.deleted-by-retention'
                : 'infrastructure.database-backup.retention-failed',
            entityType: 'infrastructure_database_backup',
            entityId: backupId,
            metadata: { operationId: operation.id, errorCode: input.errorCode ?? null },
          })
        }
      }
      return updated ?? null
    })
  }
}

function operationState(action: string) {
  if (action === 'application.stop') return 'stopped' as const
  if (action === 'application.delete') return 'deleted' as const
  return 'running' as const
}
