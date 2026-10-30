import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { applicationSpecSchema } from '../../../shared/schemas/infrastructure'
import type { UpdateApplicationEnvironmentInput } from '../../../shared/schemas/application-environment'
import type {
  ApplicationEnvironmentSnapshot,
  ApplicationEnvironmentSaveResult,
} from '../../../shared/types/application-environment'
import { useDatabase, type Database } from '../../database/client'
import {
  auditLogs,
  infrastructureResources,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureServiceDatabases,
  resourceSecretReferences,
  serviceResources,
  services,
} from '../../database/schema'
import { encryptInfrastructureCredential } from '../../utils/credentials'
import { DomainError } from '../../utils/errors'
import { validateLocalImageNode, validateSecretDelivery } from './local-image'
import { validateDeploymentNetwork } from './docker-network'

export class ApplicationEnvironmentService {
  constructor(private readonly database: Database = useDatabase()) {}

  async read(resourceId: string): Promise<ApplicationEnvironmentSnapshot> {
    const [resource] = await this.database
      .select()
      .from(infrastructureResources)
      .where(
        and(
          eq(infrastructureResources.id, resourceId),
          eq(infrastructureResources.kind, 'application'),
          isNull(infrastructureResources.deletedAt),
        ),
      )
      .limit(1)
    if (!resource) throw DomainError.notFound('Deployment aplikasi tidak ditemukan.')
    const spec = applicationSpecSchema.parse(resource.desiredSpec)
    const bindings = await this.database
      .select({ key: infrastructureServiceDatabases.environmentKey })
      .from(infrastructureServiceDatabases)
      .where(
        and(
          eq(infrastructureServiceDatabases.applicationResourceId, resourceId),
          isNull(infrastructureServiceDatabases.deletedAt),
        ),
      )
    const managed = new Set(bindings.map((binding) => binding.key))
    const keys = new Set([
      ...Object.keys(spec.environment),
      ...Object.keys(spec.secretReferences),
      ...managed,
    ])
    return {
      resourceId,
      name: resource.name,
      revision: resource.desiredRevision,
      observedRevision: resource.observedRevision,
      secretDelivery: spec.secretDelivery ?? 'files',
      variables: [...keys].sort().map((key) => {
        const secret = managed.has(key) || Object.hasOwn(spec.secretReferences, key)
        return {
          key,
          secret,
          managed: managed.has(key),
          ...(secret ? {} : { value: spec.environment[key] ?? '' }),
        }
      }),
    }
  }

  async update(
    resourceId: string,
    input: UpdateApplicationEnvironmentInput,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<ApplicationEnvironmentSaveResult> {
    return this.database.transaction(async (transaction) => {
      const [resource] = await transaction
        .select()
        .from(infrastructureResources)
        .where(
          and(
            eq(infrastructureResources.id, resourceId),
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!resource) throw DomainError.notFound('Deployment aplikasi tidak ditemukan.')

      const [existing] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, idempotencyKey))
        .limit(1)
      if (existing) {
        if (
          existing.resourceId !== resourceId ||
          existing.actorUserId !== actorUserId ||
          existing.action !== 'application.redeploy'
        ) {
          throw DomainError.conflict('Idempotency key sudah digunakan untuk operasi lain.')
        }
        return {
          operation: { id: existing.id, status: existing.status },
          revision: existing.expectedResourceRevision ?? resource.desiredRevision,
          replayed: true,
        }
      }
      if (resource.desiredRevision !== input.expectedRevision) {
        throw DomainError.conflict(
          'Konfigurasi deployment sudah berubah. Muat ulang environment sebelum menyimpan.',
        )
      }
      if (['deleting', 'deleted', 'stopped'].includes(resource.desiredState)) {
        throw DomainError.invalidState(
          'Aktifkan deployment sebelum mengubah environment dan melakukan redeploy.',
        )
      }
      const [busy] = await transaction
        .select({ id: infrastructureOperations.id })
        .from(infrastructureOperations)
        .where(
          and(
            eq(infrastructureOperations.resourceId, resourceId),
            inArray(infrastructureOperations.status, ['queued', 'dispatched', 'running']),
          ),
        )
        .limit(1)
      if (busy)
        throw DomainError.invalidState(
          'Tunggu operasi deployment yang sedang berjalan selesai sebelum mengubah environment.',
        )

      const owners = await transaction
        .select({ status: services.status, blocked: services.billingBlocked })
        .from(serviceResources)
        .innerJoin(services, eq(services.id, serviceResources.serviceId))
        .where(eq(serviceResources.resourceId, resourceId))
      if (
        owners.some((owner) => owner.status !== 'active' || owner.blocked) ||
        (resource.classification === 'billable' && owners.length !== 1)
      ) {
        throw DomainError.invalidState('Aktifkan layanan billing sebelum melakukan redeploy.')
      }
      const [node] = await transaction
        .select()
        .from(infrastructureNodes)
        .where(eq(infrastructureNodes.id, resource.nodeId))
        .limit(1)
      if (!node?.isActive || node.isDraining)
        throw DomainError.invalidState('Node tidak aktif atau sedang drain.')

      const bindings = await transaction
        .select({ key: infrastructureServiceDatabases.environmentKey })
        .from(infrastructureServiceDatabases)
        .where(
          and(
            eq(infrastructureServiceDatabases.applicationResourceId, resourceId),
            isNull(infrastructureServiceDatabases.deletedAt),
          ),
        )
      const managed = new Set(bindings.map((binding) => binding.key))
      const current = applicationSpecSchema.parse(resource.desiredSpec)
      validateLocalImageNode(
        current.source,
        resource.nodeId,
        node.capabilities,
        node.imageInventory,
      )
      validateDeploymentNetwork(current.networkName, node.capabilities, node.networkInventory)
      const environment: Record<string, string> = {}
      const secretReferences: Record<string, string> = {}
      // Database credentials remain owned by their provisioning lifecycle.
      for (const key of managed) {
        if (Object.hasOwn(current.environment, key)) environment[key] = current.environment[key]!
        if (Object.hasOwn(current.secretReferences, key))
          secretReferences[key] = current.secretReferences[key]!
      }

      for (const variable of input.variables) {
        const { key, secret, value } = variable
        if (managed.has(key))
          throw DomainError.validation(
            `${key} dikelola melalui tab Database dan tidak dapat diubah di sini.`,
          )
        if (!secret) {
          environment[key] = value ?? ''
          continue
        }
        if (value === undefined) {
          const reference = current.secretReferences[key]
          if (!reference) throw DomainError.validation(`Isi nilai secret baru ${key}.`)
          secretReferences[key] = reference
          continue
        }
        if (current.secretDelivery === 'environment' && /[\r\n]/.test(value)) {
          throw DomainError.validation(
            `Secret ${key} harus satu baris untuk pengiriman melalui environment.`,
          )
        }
        const [previous] = await transaction
          .select()
          .from(resourceSecretReferences)
          .where(
            and(
              eq(resourceSecretReferences.resourceId, resourceId),
              eq(resourceSecretReferences.environmentKey, key),
            ),
          )
          .limit(1)
        const secretId = previous?.id ?? randomUUID()
        const version = (previous?.version ?? 0) + 1
        const reference = `managed://${secretId}@${version}`
        const encryptedValue = encryptInfrastructureCredential(value)
        const delivery = current.secretDelivery === 'environment' ? 'environment' : 'file'
        await transaction
          .insert(resourceSecretReferences)
          .values({
            id: secretId,
            resourceId,
            environmentKey: key,
            secretReference: reference,
            encryptedValue,
            delivery,
            version,
          })
          .onConflictDoUpdate({
            target: [resourceSecretReferences.resourceId, resourceSecretReferences.environmentKey],
            set: {
              secretReference: reference,
              encryptedValue,
              delivery,
              version,
              updatedAt: new Date(),
            },
          })
        secretReferences[key] = reference
      }

      if (current.secretDelivery !== 'environment') {
        for (const key of Object.keys(secretReferences)) {
          if (Object.hasOwn(environment, `${key}_FILE`))
            throw DomainError.validation(
              `${key}_FILE sudah digunakan untuk pengiriman secret ${key}.`,
            )
        }
      }
      const spec = applicationSpecSchema.parse({
        ...resource.desiredSpec,
        environment,
        secretReferences,
      })
      validateSecretDelivery(spec, node.capabilities)
      const keptSecretKeys = Object.keys(secretReferences)
      await transaction
        .delete(resourceSecretReferences)
        .where(
          and(
            eq(resourceSecretReferences.resourceId, resourceId),
            keptSecretKeys.length
              ? notInArray(resourceSecretReferences.environmentKey, keptSecretKeys)
              : undefined,
          ),
        )
      const revision = resource.desiredRevision + 1
      await transaction
        .update(infrastructureResources)
        .set({
          desiredSpec: spec,
          desiredState: 'running',
          desiredRevision: revision,
          updatedAt: new Date(),
        })
        .where(eq(infrastructureResources.id, resourceId))
      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          nodeId: resource.nodeId,
          resourceId,
          actorUserId,
          idempotencyKey,
          action: 'application.redeploy',
          expectedResourceRevision: revision,
          expiresAt: new Date(Date.now() + 15 * 60_000),
          payload: { resourceId, name: resource.name, revision, spec },
        })
        .returning({ id: infrastructureOperations.id, status: infrastructureOperations.status })
      if (!operation) throw new Error('Gagal membuat operasi redeploy environment.')
      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.environment.updated',
        entityType: 'infrastructure_resource',
        entityId: resourceId,
        metadata: {
          operationId: operation.id,
          revision,
          environmentKeys: Object.keys(environment),
          secretKeys: keptSecretKeys,
        },
      })
      return { operation, revision, replayed: false }
    })
  }
}
