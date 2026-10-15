import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { ApplicationSpec } from '../../shared/schemas/infrastructure'
import type { InfrastructureTemplateDefinition } from '../../shared/schemas/infrastructure-templates'
import { useDatabase, type Database } from '../database/client'
import {
  auditLogs,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  infrastructureServiceDatabases,
  infrastructureTemplates,
  resourceSecretReferences,
  resourceVolumes,
} from '../database/schema'

export interface ManagedSecretRecord {
  id: string
  environmentKey: string
  reference: string
  encryptedValue: string
}

export interface CreateTemplateDeploymentRecord {
  resourceId: string
  externalId: string
  templateId: string
  templateVersion: number
  templateSlug: string
  engine: InfrastructureTemplateDefinition['engine']
  resourceKind: InfrastructureTemplateDefinition['resourceKind']
  nodeId: string
  name: string
  classification: 'billable' | 'internal' | 'ignored'
  spec: ApplicationSpec
  secrets: ManagedSecretRecord[]
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
}

export class InfrastructureTemplateRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  listActive() {
    return this.database
      .select()
      .from(infrastructureTemplates)
      .where(eq(infrastructureTemplates.isActive, true))
      .orderBy(asc(infrastructureTemplates.category), asc(infrastructureTemplates.name))
  }

  async findActive(templateId: string) {
    const [template] = await this.database
      .select()
      .from(infrastructureTemplates)
      .where(
        and(eq(infrastructureTemplates.id, templateId), eq(infrastructureTemplates.isActive, true)),
      )
      .limit(1)
    return template ?? null
  }

  async findOperationByIdempotencyKey(idempotencyKey: string) {
    const [operation] = await this.database
      .select()
      .from(infrastructureOperations)
      .where(eq(infrastructureOperations.idempotencyKey, idempotencyKey))
      .limit(1)
    return operation ?? null
  }

  async createDeployment(input: CreateTemplateDeploymentRecord) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, input.idempotencyKey))
        .limit(1)
      if (existing) return { operation: existing, replayed: true }

      const [node] = await transaction
        .select({ id: infrastructureNodes.id, agentVersion: infrastructureNodes.agentVersion })
        .from(infrastructureNodes)
        .where(
          and(
            eq(infrastructureNodes.id, input.nodeId),
            eq(infrastructureNodes.isActive, true),
            eq(infrastructureNodes.isDraining, false),
            inArray(infrastructureNodes.status, ['online', 'degraded']),
          ),
        )
        .limit(1)
        .for('update')
      if (!node) return null
      if (!supportsTemplateSecrets(node.agentVersion)) return { incompatibleAgent: true as const }

      const [resource] = await transaction
        .insert(infrastructureResources)
        .values({
          id: input.resourceId,
          nodeId: input.nodeId,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          externalId: input.externalId,
          kind: input.resourceKind,
          name: input.name,
          classification: input.classification,
          desiredState: 'running',
          desiredRevision: 1,
          imageReference: input.spec.source.type === 'image' ? input.spec.source.reference : null,
          desiredSpec: input.spec,
          labels: {
            'oc.managed': 'true',
            'oc.resource-id': input.resourceId,
            'oc.revision': '1',
            'oc.template': input.templateSlug,
            'oc.engine': input.engine,
          },
        })
        .returning()
      if (!resource) throw new Error('Failed to create template resource.')

      if (input.secrets.length > 0) {
        await transaction.insert(resourceSecretReferences).values(
          input.secrets.map((secret) => ({
            id: secret.id,
            resourceId: resource.id,
            environmentKey: secret.environmentKey,
            secretReference: secret.reference,
            encryptedValue: secret.encryptedValue,
            delivery: 'file' as const,
            version: 1,
          })),
        )
      }

      for (const volume of input.spec.volumes) {
        await transaction.insert(resourceVolumes).values({
          nodeId: input.nodeId,
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
          nodeId: input.nodeId,
          resourceId: resource.id,
          actorUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          action: 'application.ensure',
          expectedResourceRevision: 1,
          expiresAt: input.expiresAt,
          payload: {
            resourceId: resource.id,
            name: resource.name,
            kind: input.resourceKind,
            revision: 1,
            spec: input.spec,
          },
        })
        .returning()
      if (!operation) throw new Error('Failed to create template operation.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.template.deployed',
        entityType: 'infrastructure_resource',
        entityId: resource.id,
        metadata: {
          nodeId: input.nodeId,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          operationId: operation.id,
          secretKeys: input.secrets.map((secret) => secret.environmentKey),
        },
      })
      return { operation, resource, replayed: false }
    })
  }

  async findOperationSecrets(nodeId: string, operationId: string) {
    const [operation] = await this.database
      .select({
        id: infrastructureOperations.id,
        resourceId: infrastructureOperations.resourceId,
        action: infrastructureOperations.action,
      })
      .from(infrastructureOperations)
      .where(
        and(
          eq(infrastructureOperations.id, operationId),
          eq(infrastructureOperations.nodeId, nodeId),
          inArray(infrastructureOperations.status, ['dispatched', 'running']),
        ),
      )
      .limit(1)
    if (!operation) return null
    if (operation.action === 'database.service.ensure') {
      const [allocation] = await this.database
        .select({
          encryptedValue: infrastructureServiceDatabases.passwordEncrypted,
        })
        .from(infrastructureServiceDatabases)
        .where(eq(infrastructureServiceDatabases.provisioningOperationId, operation.id))
        .limit(1)
      if (!allocation) return null
      return [
        {
          environmentKey: 'DATABASE_PASSWORD',
          secretReference: `operation://${operation.id}/database-password`,
          encryptedValue: allocation.encryptedValue,
        },
      ]
    }
    if (!operation.resourceId) return []
    if (!['application.ensure', 'application.redeploy'].includes(operation.action)) return []

    return this.database
      .select({
        environmentKey: resourceSecretReferences.environmentKey,
        secretReference: resourceSecretReferences.secretReference,
        encryptedValue: resourceSecretReferences.encryptedValue,
      })
      .from(resourceSecretReferences)
      .where(eq(resourceSecretReferences.resourceId, operation.resourceId))
  }

  async revealResourceSecrets(resourceId: string, actorUserId: string) {
    return this.database.transaction(async (transaction) => {
      const [resource] = await transaction
        .select({
          id: infrastructureResources.id,
          name: infrastructureResources.name,
          kind: infrastructureResources.kind,
          desiredSpec: infrastructureResources.desiredSpec,
        })
        .from(infrastructureResources)
        .where(
          and(
            eq(infrastructureResources.id, resourceId),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .limit(1)
      if (!resource) return null

      const secrets = await transaction
        .select({
          environmentKey: resourceSecretReferences.environmentKey,
          encryptedValue: resourceSecretReferences.encryptedValue,
        })
        .from(resourceSecretReferences)
        .where(eq(resourceSecretReferences.resourceId, resourceId))
        .orderBy(asc(resourceSecretReferences.environmentKey))

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.secret.revealed',
        entityType: 'infrastructure_resource',
        entityId: resource.id,
        metadata: { secretKeys: secrets.map((secret) => secret.environmentKey) },
      })
      return { resource, secrets }
    })
  }
}

function supportsTemplateSecrets(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 3
}
