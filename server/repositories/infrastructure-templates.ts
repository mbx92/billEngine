import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
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
  resourceRoutes,
  resourceVolumes,
  serviceResources,
  services,
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
  applicationId?: string
  releaseId?: string
  releasePolicy?: 'manual' | 'track_latest'
  engine: InfrastructureTemplateDefinition['engine']
  resourceKind: InfrastructureTemplateDefinition['resourceKind']
  nodeId: string
  serviceId?: string
  hostname?: string
  targetPort?: number
  billingGateEnabled: boolean
  name: string
  classification: 'billable' | 'internal' | 'ignored'
  spec: ApplicationSpec
  secrets: ManagedSecretRecord[]
  actorUserId: string
  idempotencyKey: string
  expiresAt: Date
}

export interface CreateApplicationTemplateRecord {
  slug: string
  name: string
  description?: string
  applicationId: string
  releasePolicy: 'manual' | 'track_latest'
  definition: InfrastructureTemplateDefinition
  actorUserId: string
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

  async createApplicationTemplate(input: CreateApplicationTemplateRecord) {
    return this.database.transaction(async (transaction) => {
      const [template] = await transaction
        .insert(infrastructureTemplates)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description,
          category: 'application',
          definition: input.definition,
          applicationId: input.applicationId,
          releasePolicy: input.releasePolicy,
          isBuiltin: false,
          createdBy: input.actorUserId,
        })
        .returning()
      if (!template) throw new Error('Failed to create infrastructure template.')

      await transaction.insert(auditLogs).values({
        actorUserId: input.actorUserId,
        action: 'infrastructure.template.created',
        entityType: 'infrastructure_template',
        entityId: template.id,
        metadata: {
          applicationId: input.applicationId,
          releasePolicy: input.releasePolicy,
        },
      })
      return template
    })
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
        .select({
          id: infrastructureNodes.id,
          agentVersion: infrastructureNodes.agentVersion,
          gatewayStatus: infrastructureNodes.gatewayStatus,
        })
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
      if (!supportsTemplateSecrets(node.agentVersion)) {
        return { incompatibleAgent: true as const, minimumAgentVersion: '0.3.0' }
      }
      if (input.applicationId && !supportsApplicationRegistry(node.agentVersion)) {
        return { incompatibleAgent: true as const, minimumAgentVersion: '0.6.0' }
      }
      if (input.hostname && !supportsGatewayRoutes(node.agentVersion)) {
        return { incompatibleAgent: true as const, minimumAgentVersion: '0.7.2' }
      }
      if (input.hostname && node.gatewayStatus !== 'healthy') {
        return { gatewayUnavailable: true as const }
      }

      const [service] = input.serviceId
        ? await transaction
            .select({ id: services.id, customerId: services.customerId })
            .from(services)
            .where(and(eq(services.id, input.serviceId), ne(services.status, 'cancelled')))
            .limit(1)
        : []
      if (input.serviceId && !service) return { invalidService: true as const }

      const [resource] = await transaction
        .insert(infrastructureResources)
        .values({
          id: input.resourceId,
          nodeId: input.nodeId,
          customerId: service?.customerId,
          templateId: input.templateId,
          templateVersion: input.templateVersion,
          applicationId: input.applicationId,
          releaseId: input.releaseId,
          releasePolicy: input.releasePolicy ?? 'manual',
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

      if (service) {
        await transaction.insert(serviceResources).values({
          serviceId: service.id,
          resourceId: resource.id,
          createdBy: input.actorUserId,
        })
      }

      if (input.hostname && input.targetPort) {
        await transaction.insert(resourceRoutes).values({
          resourceId: resource.id,
          hostname: input.hostname,
          targetPort: input.targetPort,
          tlsEnabled: false,
          billingGateEnabled: input.billingGateEnabled,
          desiredStatus: 'pending',
          observedStatus: 'pending',
        })
      }

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
          serviceId: service?.id ?? null,
          hostname: input.hostname ?? null,
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
      return {
        action: operation.action,
        records: [{
          environmentKey: 'DATABASE_PASSWORD',
          secretReference: `operation://${operation.id}/database-password`,
          encryptedValue: allocation.encryptedValue,
        }],
      }
    }
    if (!operation.resourceId) return { action: operation.action, records: [] }
    if (!['application.ensure', 'application.redeploy'].includes(operation.action)) {
      return { action: operation.action, records: [] }
    }

    const records = await this.database
      .select({
        environmentKey: resourceSecretReferences.environmentKey,
        secretReference: resourceSecretReferences.secretReference,
        encryptedValue: resourceSecretReferences.encryptedValue,
      })
      .from(resourceSecretReferences)
      .where(eq(resourceSecretReferences.resourceId, operation.resourceId))
    return { action: operation.action, records }
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

function supportsApplicationRegistry(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 6
}

function supportsGatewayRoutes(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return major > 0 || minor > 7 || (minor === 7 && patch >= 2)
}
