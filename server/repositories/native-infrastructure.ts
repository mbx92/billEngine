import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, lt, lte } from 'drizzle-orm'
import type {
  CreateApplicationResourceInput,
  OperationStatusUpdateInput,
  UpdateApplicationResourceInput,
} from '../../shared/schemas/infrastructure'
import { useDatabase, type Database } from '../database/client'
import {
  auditLogs,
  infrastructureDatabaseClusters,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  infrastructureServiceDatabases,
  resourceObservations,
  resourceRoutes,
  resourceSecretReferences,
  resourceVolumes,
} from '../database/schema'

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
        .select({ id: infrastructureNodes.id })
        .from(infrastructureNodes)
        .where(
          and(
            eq(infrastructureNodes.id, input.input.nodeId),
            eq(infrastructureNodes.isActive, true),
            eq(infrastructureNodes.isDraining, false),
            inArray(infrastructureNodes.status, ['online', 'degraded']),
          ),
        )
        .limit(1)
        .for('update')
      if (!node) return null

      const [resource] = await transaction
        .insert(infrastructureResources)
        .values({
          id: input.resourceId,
          nodeId: input.input.nodeId,
          customerId: input.input.customerId,
          externalId: input.externalId,
          kind: 'application',
          name: input.input.name,
          classification: input.input.classification,
          desiredState: 'running',
          desiredRevision: 1,
          imageReference:
            input.input.spec.source.type === 'image' ? input.input.spec.source.reference : null,
          desiredSpec: input.input.spec,
          labels: {
            'oc.managed': 'true',
            'oc.resource-id': input.resourceId,
            'oc.revision': '1',
          },
        })
        .returning()
      if (!resource) throw new Error('Failed to create infrastructure resource.')

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

      const [operation] = await transaction
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
      .leftJoin(resourceRoutes, eq(resourceRoutes.resourceId, infrastructureResources.id))
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
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
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

      const revision = resource.desiredRevision + 1
      const [updatedResource] = await transaction
        .update(infrastructureResources)
        .set({
          name: input.input.name,
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
        metadata: { operationId: operation.id, correlationId: operation.correlationId, revision },
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
      const revision = resource.desiredRevision + 1
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

  async claimNextOperation(nodeId: string, workerId: string) {
    const now = new Date()
    return this.database.transaction(async (transaction) => {
      await transaction
        .update(infrastructureOperations)
        .set({ status: 'expired', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(infrastructureOperations.nodeId, nodeId),
            inArray(infrastructureOperations.status, ['queued', 'dispatched']),
            lte(infrastructureOperations.expiresAt, now),
          ),
        )

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

      const shouldRetry =
        input.status === 'failed' &&
        input.retryable &&
        operation.attemptCount < operation.maxAttempts
      const status = shouldRetry ? 'queued' : input.status
      const terminal = status === 'succeeded' || status === 'failed'

      const [updated] = await transaction
        .update(infrastructureOperations)
        .set({
          status,
          result: input.result,
          nextAttemptAt: shouldRetry && nextAttemptAt ? nextAttemptAt : operation.nextAttemptAt,
          lockedAt: shouldRetry ? null : operation.lockedAt,
          lockedBy: shouldRetry ? null : operation.lockedBy,
          startedAt:
            input.status === 'running' ? (operation.startedAt ?? now) : operation.startedAt,
          completedAt: terminal ? now : null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
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
              typeof input.result?.containerId === 'string'
                ? input.result.containerId
                : undefined,
            gatewayLastObservedAt: now,
            gatewayLastError:
              gatewayStatus === 'healthy' ? null : (input.errorMessage ?? null),
            updatedAt: now,
          })
          .where(eq(infrastructureNodes.id, nodeId))
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
              typeof input.result?.externalId === 'string' ? input.result.externalId : undefined,
            imageDigest:
              typeof input.result?.imageDigest === 'string' ? input.result.imageDigest : undefined,
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
          snapshot: input.result ?? {},
          observedAt: now,
        })

        if (['application.ensure', 'application.redeploy'].includes(operation.action)) {
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
                  billingGateUrl: route.billingGateEnabled
                    ? billingGateInternalUrl
                    : undefined,
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
              await transaction.insert(resourceSecretReferences).values({
                id: secretId,
                resourceId: application.id,
                environmentKey: allocation.environmentKey,
                secretReference,
                encryptedValue: allocation.connectionUriEncrypted,
                delivery: 'file',
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
            const revision = application.desiredRevision + 1
            await transaction
              .update(infrastructureResources)
              .set({
                desiredSpec,
                desiredState: 'running',
                desiredRevision: revision,
                updatedAt: now,
              })
              .where(eq(infrastructureResources.id, application.id))

            const [redeployOperation] = await transaction
              .insert(infrastructureOperations)
              .values({
                nodeId: application.nodeId,
                resourceId: application.id,
                actorUserId: operation.actorUserId,
                idempotencyKey: `service-database:${allocation.id}:application-redeploy:${revision}`,
                action: 'application.redeploy',
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
      return updated ?? null
    })
  }
}

function operationState(action: string) {
  if (action === 'application.stop') return 'stopped' as const
  if (action === 'application.delete') return 'deleted' as const
  return 'running' as const
}
