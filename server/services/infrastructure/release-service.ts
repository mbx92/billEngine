import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type {
  CreateApplicationReleaseInput,
  CreateContainerRegistryInput,
  CreateDeployableApplicationInput,
  ReleaseCallbackInput,
  RolloutApplicationReleaseInput,
} from '../../../shared/schemas/releases'
import { useDatabase, type Database, type Transaction } from '../../database/client'
import {
  applicationReleases,
  auditLogs,
  containerRegistries,
  deployableApplications,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
} from '../../database/schema'
import {
  decryptInfrastructureCredential,
  encryptInfrastructureCredential,
} from '../../utils/credentials'
import { DomainError } from '../../utils/errors'

export class InfrastructureReleaseService {
  constructor(private readonly database: Database = useDatabase()) {}

  async catalog() {
    const [registries, applications, releases, resources] = await Promise.all([
      this.database
        .select({
          id: containerRegistries.id,
          name: containerRegistries.name,
          host: containerRegistries.host,
          username: containerRegistries.username,
          isActive: containerRegistries.isActive,
          createdAt: containerRegistries.createdAt,
        })
        .from(containerRegistries)
        .orderBy(asc(containerRegistries.name)),
      this.database.select().from(deployableApplications).orderBy(asc(deployableApplications.name)),
      this.database.select().from(applicationReleases).orderBy(desc(applicationReleases.createdAt)),
      this.database
        .select({
          id: infrastructureResources.id,
          name: infrastructureResources.name,
          nodeName: infrastructureNodes.name,
          applicationId: infrastructureResources.applicationId,
          releaseId: infrastructureResources.releaseId,
          releasePolicy: infrastructureResources.releasePolicy,
          imageReference: infrastructureResources.imageReference,
          observedState: infrastructureResources.observedState,
        })
        .from(infrastructureResources)
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(
          and(
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .orderBy(asc(infrastructureResources.name)),
    ])

    return {
      registries: registries.map(serializeDates),
      applications: applications.map(serializeDates),
      releases: releases.map(serializeDates),
      resources,
    }
  }

  async createRegistry(input: CreateContainerRegistryInput, actorUserId: string) {
    try {
      const [registry] = await this.database
        .insert(containerRegistries)
        .values({
          name: input.name,
          host: input.host,
          username: input.username,
          tokenEncrypted: encryptInfrastructureCredential(input.token),
          createdBy: actorUserId,
        })
        .returning({
          id: containerRegistries.id,
          name: containerRegistries.name,
          host: containerRegistries.host,
          username: containerRegistries.username,
          isActive: containerRegistries.isActive,
          createdAt: containerRegistries.createdAt,
        })
      if (!registry) throw new Error('Failed to create registry.')
      return serializeDates(registry)
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Host registry sudah terdaftar.')
      throw error
    }
  }

  async createApplication(input: CreateDeployableApplicationInput, actorUserId: string) {
    const [registry] = await this.database
      .select({ id: containerRegistries.id, host: containerRegistries.host })
      .from(containerRegistries)
      .where(
        and(eq(containerRegistries.id, input.registryId), eq(containerRegistries.isActive, true)),
      )
      .limit(1)
    if (!registry) throw DomainError.notFound('Registry tidak ditemukan atau tidak aktif.')
    if (!input.imageRepository.startsWith(`${registry.host}/`)) {
      throw DomainError.validation(`Image repository harus berada di ${registry.host}.`)
    }

    try {
      const [application] = await this.database
        .insert(deployableApplications)
        .values({ ...input, createdBy: actorUserId })
        .returning()
      if (!application) throw new Error('Failed to create deployable application.')
      return serializeDates(application)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw DomainError.conflict('Slug atau image repository sudah terdaftar.')
      }
      throw error
    }
  }

  async createRelease(
    applicationId: string,
    input: CreateApplicationReleaseInput,
    actorUserId: string | null,
  ) {
    const application = await this.findApplication(applicationId)
    return this.persistRelease(application, input, actorUserId)
  }

  async latestRelease(applicationId: string) {
    const [release] = await this.database
      .select()
      .from(applicationReleases)
      .where(eq(applicationReleases.applicationId, applicationId))
      .orderBy(desc(applicationReleases.createdAt))
      .limit(1)
    return release ? serializeDates(release) : null
  }

  async receiveRelease(input: ReleaseCallbackInput) {
    const [application] = await this.database
      .select()
      .from(deployableApplications)
      .where(eq(deployableApplications.slug, input.applicationSlug))
      .limit(1)
    if (!application) throw DomainError.notFound('Application slug tidak ditemukan.')

    const release = await this.persistRelease(application, input, null)
    const operations = application.autoDeploy
      ? await this.rolloutTrackedResources(application.id, release.id, null)
      : []
    return { release, operationsQueued: operations.length }
  }

  async rollout(releaseId: string, input: RolloutApplicationReleaseInput, actorUserId: string) {
    const [release] = await this.database
      .select()
      .from(applicationReleases)
      .where(eq(applicationReleases.id, releaseId))
      .limit(1)
    if (!release) throw DomainError.notFound('Release tidak ditemukan.')

    return this.database.transaction(async (transaction) => {
      const resources = await transaction
        .select()
        .from(infrastructureResources)
        .where(
          and(
            inArray(infrastructureResources.id, input.resourceIds),
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .for('update')
      if (resources.length !== input.resourceIds.length) {
        throw DomainError.notFound('Satu atau lebih application resource tidak ditemukan.')
      }
      return this.queueReleaseForResources(
        transaction,
        release,
        resources,
        actorUserId,
        input.trackLatest ? 'track_latest' : 'manual',
      )
    })
  }

  async registryCredentialForOperation(nodeId: string, operationId: string) {
    const [record] = await this.database
      .select({
        action: infrastructureOperations.action,
        imageReference: infrastructureResources.imageReference,
        host: containerRegistries.host,
        username: containerRegistries.username,
        tokenEncrypted: containerRegistries.tokenEncrypted,
      })
      .from(infrastructureOperations)
      .innerJoin(
        infrastructureResources,
        eq(infrastructureResources.id, infrastructureOperations.resourceId),
      )
      .innerJoin(
        deployableApplications,
        eq(deployableApplications.id, infrastructureResources.applicationId),
      )
      .innerJoin(containerRegistries, eq(containerRegistries.id, deployableApplications.registryId))
      .where(
        and(
          eq(infrastructureOperations.id, operationId),
          eq(infrastructureOperations.nodeId, nodeId),
          inArray(infrastructureOperations.status, ['dispatched', 'running']),
          eq(containerRegistries.isActive, true),
        ),
      )
      .limit(1)

    if (!record || !['application.ensure', 'application.redeploy'].includes(record.action)) {
      return null
    }
    if (!record.imageReference?.startsWith(`${record.host}/`)) {
      throw DomainError.invalidState('Image resource tidak cocok dengan registry application.')
    }
    return {
      host: record.host,
      username: record.username,
      token: decryptInfrastructureCredential(record.tokenEncrypted),
    }
  }

  private async findApplication(applicationId: string) {
    const [application] = await this.database
      .select()
      .from(deployableApplications)
      .where(eq(deployableApplications.id, applicationId))
      .limit(1)
    if (!application) throw DomainError.notFound('Application tidak ditemukan.')
    return application
  }

  private async persistRelease(
    application: typeof deployableApplications.$inferSelect,
    input: CreateApplicationReleaseInput,
    actorUserId: string | null,
  ) {
    const imageReference = `${application.imageRepository}@${input.imageDigest}`
    return this.database.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(applicationReleases)
        .values({
          applicationId: application.id,
          version: input.version,
          commitSha: input.commitSha,
          imageDigest: input.imageDigest,
          imageReference,
        })
        .onConflictDoNothing()
        .returning()

      const release =
        inserted ??
        (
          await transaction
            .select()
            .from(applicationReleases)
            .where(
              and(
                eq(applicationReleases.applicationId, application.id),
                eq(applicationReleases.version, input.version),
              ),
            )
            .limit(1)
        )[0]
      if (!release || release.imageDigest !== input.imageDigest) {
        throw DomainError.conflict('Versi release sudah menunjuk image digest yang berbeda.')
      }
      if (inserted) {
        await transaction.insert(auditLogs).values({
          actorUserId,
          action: 'infrastructure.release.created',
          entityType: 'application_release',
          entityId: release.id,
          metadata: { applicationId: application.id, version: release.version, imageReference },
        })
      }
      return serializeDates(release)
    })
  }

  private async rolloutTrackedResources(
    applicationId: string,
    releaseId: string,
    actorUserId: string | null,
  ) {
    return this.database.transaction(async (transaction) => {
      const [release] = await transaction
        .select()
        .from(applicationReleases)
        .where(eq(applicationReleases.id, releaseId))
        .limit(1)
      if (!release) throw DomainError.notFound('Release tidak ditemukan.')
      const resources = await transaction
        .select()
        .from(infrastructureResources)
        .where(
          and(
            eq(infrastructureResources.applicationId, applicationId),
            eq(infrastructureResources.releasePolicy, 'track_latest'),
            eq(infrastructureResources.kind, 'application'),
            isNull(infrastructureResources.deletedAt),
          ),
        )
        .for('update')
      return this.queueReleaseForResources(
        transaction,
        release,
        resources,
        actorUserId,
        'track_latest',
      )
    })
  }

  private async queueReleaseForResources(
    transaction: Transaction,
    release: typeof applicationReleases.$inferSelect,
    resources: Array<typeof infrastructureResources.$inferSelect>,
    actorUserId: string | null,
    policy: 'manual' | 'track_latest',
  ) {
    const operations = []
    for (const resource of resources) {
      if (resource.releaseId === release.id) {
        if (resource.applicationId !== release.applicationId || resource.releasePolicy !== policy) {
          await transaction
            .update(infrastructureResources)
            .set({
              applicationId: release.applicationId,
              releasePolicy: policy,
              updatedAt: new Date(),
            })
            .where(eq(infrastructureResources.id, resource.id))
        }
        continue
      }
      const revision = resource.desiredRevision + 1
      const desiredSpec = {
        ...resource.desiredSpec,
        source: { type: 'image', reference: release.imageReference },
      }
      await transaction
        .update(infrastructureResources)
        .set({
          applicationId: release.applicationId,
          releaseId: release.id,
          releasePolicy: policy,
          desiredState: 'running',
          desiredRevision: revision,
          imageReference: release.imageReference,
          desiredSpec,
          updatedAt: new Date(),
        })
        .where(eq(infrastructureResources.id, resource.id))

      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          nodeId: resource.nodeId,
          resourceId: resource.id,
          actorUserId,
          idempotencyKey: `release:${release.id}:${resource.id}:${revision}`,
          action: 'application.redeploy',
          expectedResourceRevision: revision,
          expiresAt: new Date(Date.now() + 15 * 60_000),
          payload: {
            resourceId: resource.id,
            name: resource.name,
            kind: resource.kind,
            revision,
            spec: desiredSpec,
          },
        })
        .onConflictDoNothing()
        .returning()
      if (operation) operations.push(operation)

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.release.rollout',
        entityType: 'infrastructure_resource',
        entityId: resource.id,
        metadata: { applicationId: release.applicationId, releaseId: release.id, revision, policy },
      })
    }
    return operations
  }
}

function serializeDates<T extends { createdAt: Date; updatedAt?: Date }>(record: T) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    ...(record.updatedAt ? { updatedAt: record.updatedAt.toISOString() } : {}),
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
