import { and, asc, count, eq, gt, inArray, isNull, lt, min, ne, or } from 'drizzle-orm'
import type {
  AgentHeartbeatInput,
  AgentInventoryInput,
  CreateNodeEnrollmentInput,
  EnrollNodeInput,
} from '../../shared/schemas/infrastructure'
import { useDatabase, type Database } from '../database/client'
import {
  auditLogs,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  nodeEnrollments,
  nodeIdentities,
  resourceObservations,
} from '../database/schema'

export interface CreateEnrollmentRecord extends CreateNodeEnrollmentInput {
  tokenHash: string
  expiresAt: Date
  actorUserId: string
}

export interface ConsumeEnrollmentRecord {
  tokenHash: string
  credentialHash: string
  fingerprint: string
  gatewayImage: string
  node: Omit<EnrollNodeInput, 'token'>
}

export type AgentOperationAction = 'agent.upgrade' | 'agent.rollback'

export interface QueueAgentOperationRecord {
  nodeId: string
  actorUserId: string
  idempotencyKey: string
  action: AgentOperationAction
  targetVersion: string
  payload: Record<string, unknown>
  expiresAt: Date
}

export class InfrastructureControlRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async listNodes(stuckBefore = new Date(Date.now() - 15 * 60_000)) {
    const [rows, stuckRows] = await Promise.all([
      this.database
        .select({
          id: infrastructureNodes.id,
          name: infrastructureNodes.name,
          environment: infrastructureNodes.environment,
          role: infrastructureNodes.role,
          status: infrastructureNodes.status,
          isActive: infrastructureNodes.isActive,
          isDraining: infrastructureNodes.isDraining,
          agentVersion: infrastructureNodes.agentVersion,
          previousAgentVersion: infrastructureNodes.previousAgentVersion,
          targetAgentVersion: infrastructureNodes.targetAgentVersion,
          agentUpdateStatus: infrastructureNodes.agentUpdateStatus,
          agentLastUpdateAt: infrastructureNodes.agentLastUpdateAt,
          agentLastUpdateError: infrastructureNodes.agentLastUpdateError,
          protocolVersion: infrastructureNodes.protocolVersion,
          osRelease: infrastructureNodes.osRelease,
          architecture: infrastructureNodes.architecture,
          dockerVersion: infrastructureNodes.dockerVersion,
          composeVersion: infrastructureNodes.composeVersion,
          gatewayStatus: infrastructureNodes.gatewayStatus,
          gatewayVersion: infrastructureNodes.gatewayVersion,
          gatewayContainerId: infrastructureNodes.gatewayContainerId,
          gatewayLastObservedAt: infrastructureNodes.gatewayLastObservedAt,
          gatewayLastError: infrastructureNodes.gatewayLastError,
          capacityCpuMilli: infrastructureNodes.capacityCpuMilli,
          capacityMemoryBytes: infrastructureNodes.capacityMemoryBytes,
          capacityDiskBytes: infrastructureNodes.capacityDiskBytes,
          cpuUsageBasisPoints: infrastructureNodes.cpuUsageBasisPoints,
          memoryUsedBytes: infrastructureNodes.memoryUsedBytes,
          diskUsedBytes: infrastructureNodes.diskUsedBytes,
          diskUsageBasisPoints: infrastructureNodes.diskUsageBasisPoints,
          utilizationObservedAt: infrastructureNodes.utilizationObservedAt,
          labels: infrastructureNodes.labels,
          capabilities: infrastructureNodes.capabilities,
          lastHeartbeatAt: infrastructureNodes.lastHeartbeatAt,
          lastInventoryAt: infrastructureNodes.lastInventoryAt,
          lastError: infrastructureNodes.lastError,
          resourceCount: count(infrastructureResources.id),
          createdAt: infrastructureNodes.createdAt,
          updatedAt: infrastructureNodes.updatedAt,
        })
        .from(infrastructureNodes)
        .leftJoin(
          infrastructureResources,
          and(
            eq(infrastructureResources.nodeId, infrastructureNodes.id),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .groupBy(infrastructureNodes.id)
        .orderBy(asc(infrastructureNodes.environment), asc(infrastructureNodes.name)),
      this.database
        .select({
          nodeId: infrastructureOperations.nodeId,
          total: count(),
          oldestAt: min(infrastructureOperations.createdAt),
        })
        .from(infrastructureOperations)
        .where(
          and(
            inArray(infrastructureOperations.status, ['queued', 'dispatched', 'running']),
            lt(infrastructureOperations.createdAt, stuckBefore),
          ),
        )
        .groupBy(infrastructureOperations.nodeId),
    ])
    const stuckByNode = new Map(stuckRows.map((row) => [row.nodeId, row]))

    const staleBefore = Date.now() - 90_000
    return rows.map((row) => {
      const status =
        row.isActive &&
        row.status !== 'revoked' &&
        (!row.lastHeartbeatAt || row.lastHeartbeatAt.getTime() < staleBefore)
          ? 'offline'
          : row.status
      return {
        ...row,
        status,
        capacityMemoryBytes: row.capacityMemoryBytes?.toString() ?? null,
        capacityDiskBytes: row.capacityDiskBytes?.toString() ?? null,
        memoryUsedBytes: row.memoryUsedBytes?.toString() ?? null,
        diskUsedBytes: row.diskUsedBytes?.toString() ?? null,
        utilizationObservedAt: row.utilizationObservedAt?.toISOString() ?? null,
        stuckOperationCount: Number(stuckByNode.get(row.id)?.total ?? 0),
        oldestStuckOperationAt: stuckByNode.get(row.id)?.oldestAt?.toISOString() ?? null,
        resourceCount: Number(row.resourceCount),
        lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
        lastInventoryAt: row.lastInventoryAt?.toISOString() ?? null,
        gatewayLastObservedAt: row.gatewayLastObservedAt?.toISOString() ?? null,
        agentLastUpdateAt: row.agentLastUpdateAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    })
  }

  async createEnrollment(input: CreateEnrollmentRecord) {
    const [created] = await this.database
      .insert(nodeEnrollments)
      .values({
        nodeName: input.nodeName,
        environment: input.environment,
        role: input.role ?? 'deployment',
        tokenHash: input.tokenHash,
        labels: input.labels,
        expiresAt: input.expiresAt,
        createdBy: input.actorUserId,
      })
      .returning({
        id: nodeEnrollments.id,
        nodeName: nodeEnrollments.nodeName,
        environment: nodeEnrollments.environment,
        role: nodeEnrollments.role,
        labels: nodeEnrollments.labels,
        expiresAt: nodeEnrollments.expiresAt,
        createdAt: nodeEnrollments.createdAt,
      })

    if (!created) throw new Error('Failed to create node enrollment.')
    return created
  }

  async consumeEnrollment(input: ConsumeEnrollmentRecord) {
    const now = new Date()

    return this.database.transaction(async (transaction) => {
      const [enrollment] = await transaction
        .select()
        .from(nodeEnrollments)
        .where(
          and(
            eq(nodeEnrollments.tokenHash, input.tokenHash),
            isNull(nodeEnrollments.usedAt),
            isNull(nodeEnrollments.revokedAt),
            gt(nodeEnrollments.expiresAt, now),
          ),
        )
        .limit(1)
        .for('update')

      if (!enrollment) return null

      const [existingNode] = await transaction
        .select({ id: infrastructureNodes.id })
        .from(infrastructureNodes)
        .where(
          and(
            eq(infrastructureNodes.name, enrollment.nodeName),
            eq(infrastructureNodes.environment, enrollment.environment),
          ),
        )
        .limit(1)
        .for('update')

      let nodeId: string
      if (existingNode) {
        nodeId = existingNode.id
        await transaction
          .update(infrastructureNodes)
          .set({
            status: 'online',
            isActive: true,
            role: enrollment.role,
            labels: enrollment.labels,
            ...input.node,
            lastHeartbeatAt: now,
            lastError: null,
            gatewayStatus: enrollment.role === 'builder' ? 'unknown' : 'pending',
            gatewayLastError: null,
            targetAgentVersion: null,
            agentUpdateStatus: 'idle',
            agentLastUpdateError: null,
            updatedAt: now,
          })
          .where(eq(infrastructureNodes.id, nodeId))

        await transaction
          .update(nodeIdentities)
          .set({ revokedAt: now })
          .where(and(eq(nodeIdentities.nodeId, nodeId), isNull(nodeIdentities.revokedAt)))
      } else {
        const [createdNode] = await transaction
          .insert(infrastructureNodes)
          .values({
            name: enrollment.nodeName,
            environment: enrollment.environment,
            role: enrollment.role,
            labels: enrollment.labels,
            status: 'online',
            gatewayStatus: enrollment.role === 'builder' ? 'unknown' : 'pending',
            ...input.node,
            lastHeartbeatAt: now,
          })
          .returning({ id: infrastructureNodes.id })

        if (!createdNode) throw new Error('Failed to create infrastructure node.')
        nodeId = createdNode.id
      }

      await transaction.insert(nodeIdentities).values({
        nodeId,
        credentialHash: input.credentialHash,
        fingerprint: input.fingerprint,
      })

      if (enrollment.role !== 'builder') {
        await transaction.insert(infrastructureOperations).values({
          nodeId,
          actorUserId: enrollment.createdBy,
          idempotencyKey: `gateway.ensure:${nodeId}:${enrollment.id}`,
          action: 'gateway.ensure',
          expiresAt: new Date(now.getTime() + 30 * 60_000),
          payload: { image: input.gatewayImage },
        })
      }

      await transaction
        .update(nodeEnrollments)
        .set({ usedAt: now })
        .where(eq(nodeEnrollments.id, enrollment.id))

      await transaction.insert(auditLogs).values({
        actorUserId: enrollment.createdBy,
        action: existingNode ? 'infrastructure.node.reenrolled' : 'infrastructure.node.enrolled',
        entityType: 'infrastructure_node',
        entityId: nodeId,
        metadata: {
          environment: enrollment.environment,
          role: enrollment.role,
          agentVersion: input.node.agentVersion,
          protocolVersion: input.node.protocolVersion,
          fingerprint: input.fingerprint,
        },
      })

      return {
        nodeId,
        nodeName: enrollment.nodeName,
        environment: enrollment.environment,
        role: enrollment.role,
      }
    })
  }

  async findIdentity(credentialHash: string) {
    const now = new Date()
    const [identity] = await this.database
      .select({
        identityId: nodeIdentities.id,
        nodeId: infrastructureNodes.id,
        nodeName: infrastructureNodes.name,
        environment: infrastructureNodes.environment,
        role: infrastructureNodes.role,
        status: infrastructureNodes.status,
      })
      .from(nodeIdentities)
      .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, nodeIdentities.nodeId))
      .where(
        and(
          eq(nodeIdentities.credentialHash, credentialHash),
          isNull(nodeIdentities.revokedAt),
          or(isNull(nodeIdentities.expiresAt), gt(nodeIdentities.expiresAt, now)),
          eq(infrastructureNodes.isActive, true),
          ne(infrastructureNodes.status, 'revoked'),
        ),
      )
      .limit(1)

    if (!identity) return null

    const lastUsedCutoff = new Date(now.getTime() - 5 * 60_000)
    await this.database
      .update(nodeIdentities)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(nodeIdentities.id, identity.identityId),
          or(isNull(nodeIdentities.lastUsedAt), lt(nodeIdentities.lastUsedAt, lastUsedCutoff)),
        ),
      )

    return identity
  }

  async recordHeartbeat(nodeId: string, input: AgentHeartbeatInput, gatewayImage: string) {
    const now = new Date()
    const gateway = input.gateway
    const [updated] = await this.database
      .update(infrastructureNodes)
      .set({
        status: 'online',
        agentVersion: input.agentVersion,
        previousAgentVersion: input.update ? (input.update.previousVersion ?? null) : undefined,
        protocolVersion: input.protocolVersion,
        osRelease: input.osRelease,
        architecture: input.architecture,
        dockerVersion: input.dockerVersion,
        composeVersion: input.composeVersion,
        capabilities: input.capabilities ?? [],
        capacityCpuMilli: input.capacity.cpuMilli,
        capacityMemoryBytes: BigInt(input.capacity.memoryBytes),
        capacityDiskBytes: BigInt(input.capacity.diskBytes),
        cpuUsageBasisPoints: input.usage?.cpuUsageBasisPoints,
        memoryUsedBytes: input.usage ? BigInt(input.usage.memoryUsedBytes) : undefined,
        diskUsedBytes: input.usage ? BigInt(input.usage.diskUsedBytes) : undefined,
        diskUsageBasisPoints: input.usage?.diskUsageBasisPoints,
        utilizationObservedAt: input.usage ? now : undefined,
        gatewayStatus: gateway?.status,
        gatewayVersion: gateway?.image,
        gatewayContainerId: gateway?.containerId,
        gatewayLastObservedAt: gateway ? now : undefined,
        gatewayLastError: gateway
          ? gateway.status === 'healthy'
            ? null
            : (gateway.error ?? null)
          : undefined,
        lastHeartbeatAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(infrastructureNodes.id, nodeId), eq(infrastructureNodes.isActive, true)))
      .returning({
        id: infrastructureNodes.id,
        status: infrastructureNodes.status,
        isDraining: infrastructureNodes.isDraining,
      })

    if (
      updated &&
      gateway &&
      gateway.status !== 'healthy' &&
      supportsGatewayHealthcheckV3(input.agentVersion)
    ) {
      const [activeGatewayOperation] = await this.database
        .select({ id: infrastructureOperations.id })
        .from(infrastructureOperations)
        .where(
          and(
            eq(infrastructureOperations.nodeId, nodeId),
            eq(infrastructureOperations.action, 'gateway.ensure'),
            inArray(infrastructureOperations.status, ['queued', 'dispatched', 'running']),
          ),
        )
        .limit(1)
      if (!activeGatewayOperation) {
        await this.database
          .insert(infrastructureOperations)
          .values({
            nodeId,
            idempotencyKey: `gateway.ensure:${nodeId}:bootstrap-v3`,
            action: 'gateway.ensure',
            expiresAt: new Date(now.getTime() + 30 * 60_000),
            payload: { image: gatewayImage },
          })
          .onConflictDoNothing({ target: infrastructureOperations.idempotencyKey })
      }
    }

    return updated ?? null
  }

  async recordInventory(nodeId: string, input: AgentInventoryInput) {
    const observedAt = new Date(input.observedAt)
    return this.database.transaction(async (transaction) => {
      const [node] = await transaction
        .update(infrastructureNodes)
        .set({ lastInventoryAt: observedAt, updatedAt: new Date() })
        .where(and(eq(infrastructureNodes.id, nodeId), eq(infrastructureNodes.isActive, true)))
        .returning({ id: infrastructureNodes.id })

      if (!node) return null

      let matchedCount = 0
      for (const observation of input.resources) {
        if (!observation.resourceId) continue

        const [resource] = await transaction
          .update(infrastructureResources)
          .set({
            externalId: observation.externalId,
            observedState: observation.state,
            observedRevision: observation.observedRevision,
            imageReference: observation.imageReference,
            imageDigest: observation.imageDigest,
            observedSpec: observation.snapshot,
            labels: observation.labels,
            lastObservedAt: observedAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(infrastructureResources.id, observation.resourceId),
              eq(infrastructureResources.nodeId, nodeId),
              isNull(infrastructureResources.deletedAt),
            ),
          )
          .returning({ id: infrastructureResources.id })

        if (!resource) continue
        matchedCount += 1
        await transaction.insert(resourceObservations).values({
          nodeId,
          resourceId: resource.id,
          observedRevision: observation.observedRevision,
          state: observation.state,
          snapshot: observation.snapshot,
          observedAt,
        })
      }

      return { receivedCount: input.resources.length, matchedCount, observedAt: input.observedAt }
    })
  }

  async findNodeForAgentOperation(nodeId: string) {
    const [node] = await this.database
      .select({
        id: infrastructureNodes.id,
        name: infrastructureNodes.name,
        status: infrastructureNodes.status,
        isActive: infrastructureNodes.isActive,
        agentVersion: infrastructureNodes.agentVersion,
        previousAgentVersion: infrastructureNodes.previousAgentVersion,
        architecture: infrastructureNodes.architecture,
        agentUpdateStatus: infrastructureNodes.agentUpdateStatus,
        lastHeartbeatAt: infrastructureNodes.lastHeartbeatAt,
      })
      .from(infrastructureNodes)
      .where(eq(infrastructureNodes.id, nodeId))
      .limit(1)
    return node ?? null
  }

  async queueAgentOperation(input: QueueAgentOperationRecord) {
    return this.database.transaction(async (transaction) => {
      const [existingByKey] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existingByKey) {
        const sameRequest =
          existingByKey.nodeId === input.nodeId && existingByKey.action === input.action
        return { operation: existingByKey, replayed: sameRequest, conflict: !sameRequest }
      }

      const [node] = await transaction
        .select({ id: infrastructureNodes.id })
        .from(infrastructureNodes)
        .where(
          and(
            eq(infrastructureNodes.id, input.nodeId),
            eq(infrastructureNodes.isActive, true),
            inArray(infrastructureNodes.status, ['online', 'degraded']),
          ),
        )
        .limit(1)
        .for('update')
      if (!node) return null

      const [activeOperation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(
          and(
            eq(infrastructureOperations.nodeId, input.nodeId),
            inArray(infrastructureOperations.action, ['agent.upgrade', 'agent.rollback']),
            inArray(infrastructureOperations.status, ['queued', 'dispatched', 'running']),
          ),
        )
        .limit(1)
      if (activeOperation) return { operation: activeOperation, replayed: false, conflict: true }

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          nodeId: input.nodeId,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: input.action,
          maxAttempts: 1,
          expiresAt: input.expiresAt,
          payload: input.payload,
        })
        .returning()
      if (!operation) throw new Error('Failed to create agent update operation.')

      await transaction
        .update(infrastructureNodes)
        .set({
          targetAgentVersion: input.targetVersion,
          agentUpdateStatus: 'queued',
          agentLastUpdateError: null,
          updatedAt: new Date(),
        })
        .where(eq(infrastructureNodes.id, input.nodeId))

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: `infrastructure.${input.action}`,
        entityType: 'infrastructure_node',
        entityId: input.nodeId,
        metadata: {
          operationId: operation.id,
          correlationId: operation.correlationId,
          targetVersion: input.targetVersion,
        },
      })

      return { operation, replayed: false, conflict: false }
    })
  }

  async revokeNode(nodeId: string, actorUserId: string) {
    const now = new Date()
    return this.database.transaction(async (transaction) => {
      const [node] = await transaction
        .update(infrastructureNodes)
        .set({ status: 'revoked', isActive: false, updatedAt: now })
        .where(eq(infrastructureNodes.id, nodeId))
        .returning({ id: infrastructureNodes.id, name: infrastructureNodes.name })

      if (!node) return null

      await transaction
        .update(nodeIdentities)
        .set({ revokedAt: now })
        .where(and(eq(nodeIdentities.nodeId, nodeId), isNull(nodeIdentities.revokedAt)))

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.node.revoked',
        entityType: 'infrastructure_node',
        entityId: nodeId,
        metadata: { nodeName: node.name },
      })

      return node
    })
  }
}

function supportsGatewayHealthcheckV3(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return major > 0 || minor > 7 || (minor === 7 && patch >= 2)
}
