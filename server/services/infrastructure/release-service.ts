import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ApplicationSpec } from '../../../shared/schemas/infrastructure'
import type {
  CreateApplicationReleaseInput,
  CreateContainerRegistryInput,
  CreateDeployableApplicationInput,
  ReleaseCallbackInput,
  RolloutApplicationReleaseInput,
  UpdateContainerRegistryInput,
} from '../../../shared/schemas/releases'
import { useDatabase, type Database, type Transaction } from '../../database/client'
import {
  applicationReleases,
  applicationBuilds,
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
import { releaseImageSource, validateLocalImageNode, validateSecretDelivery } from './local-image'

export class InfrastructureReleaseService {
  constructor(private readonly database: Database = useDatabase()) {}

  async catalog() {
    const [registries, applications, releases, resources, builds, builders, localNodes] =
      await Promise.all([
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
        this.database
          .select()
          .from(deployableApplications)
          .orderBy(asc(deployableApplications.name)),
        this.database
          .select()
          .from(applicationReleases)
          .orderBy(desc(applicationReleases.createdAt)),
        this.database
          .select({
            id: infrastructureResources.id,
            name: infrastructureResources.name,
            nodeId: infrastructureResources.nodeId,
            nodeName: infrastructureNodes.name,
            applicationId: infrastructureResources.applicationId,
            releaseId: infrastructureResources.releaseId,
            releasePolicy: infrastructureResources.releasePolicy,
            imageReference: infrastructureResources.imageReference,
            observedState: infrastructureResources.observedState,
          })
          .from(infrastructureResources)
          .innerJoin(
            infrastructureNodes,
            eq(infrastructureNodes.id, infrastructureResources.nodeId),
          )
          .where(
            and(
              eq(infrastructureResources.kind, 'application'),
              isNull(infrastructureResources.deletedAt),
            ),
          )
          .orderBy(asc(infrastructureResources.name)),
        this.database
          .select({
            id: applicationBuilds.id,
            applicationId: applicationBuilds.applicationId,
            nodeId: applicationBuilds.nodeId,
            nodeName: infrastructureNodes.name,
            releaseId: applicationBuilds.releaseId,
            status: applicationBuilds.status,
            version: applicationBuilds.version,
            commitSha: applicationBuilds.commitSha,
            imageDigest: applicationBuilds.imageDigest,
            imageReference: applicationBuilds.imageReference,
            logExcerpt: applicationBuilds.logExcerpt,
            errorCode: applicationBuilds.errorCode,
            errorMessage: applicationBuilds.errorMessage,
            startedAt: applicationBuilds.startedAt,
            completedAt: applicationBuilds.completedAt,
            createdAt: applicationBuilds.createdAt,
            updatedAt: applicationBuilds.updatedAt,
          })
          .from(applicationBuilds)
          .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, applicationBuilds.nodeId))
          .orderBy(desc(applicationBuilds.createdAt))
          .limit(50),
        this.database
          .select({
            id: infrastructureNodes.id,
            name: infrastructureNodes.name,
            role: infrastructureNodes.role,
            capabilities: infrastructureNodes.capabilities,
          })
          .from(infrastructureNodes)
          .where(
            and(
              eq(infrastructureNodes.isActive, true),
              eq(infrastructureNodes.isDraining, false),
              inArray(infrastructureNodes.status, ['online', 'degraded']),
              inArray(infrastructureNodes.role, ['builder', 'hybrid']),
              sql`${infrastructureNodes.lastHeartbeatAt} >= now() - interval '90 seconds'`,
              sql`${infrastructureNodes.capabilities} @> '["image-build"]'::jsonb`,
            ),
          ),
        this.database
          .select({
            id: infrastructureNodes.id,
            name: infrastructureNodes.name,
            status: infrastructureNodes.status,
            isDraining: infrastructureNodes.isDraining,
            lastHeartbeatAt: infrastructureNodes.lastHeartbeatAt,
            capabilities: infrastructureNodes.capabilities,
          })
          .from(infrastructureNodes)
          .where(
            and(eq(infrastructureNodes.isActive, true), eq(infrastructureNodes.role, 'hybrid')),
          )
          .orderBy(asc(infrastructureNodes.name)),
      ])

    return {
      registries: registries.map(serializeDates),
      applications: applications.map(serializeDates),
      releases: releases.map(serializeDates),
      resources,
      builds: builds.map((build) => ({
        ...build,
        startedAt: build.startedAt?.toISOString() ?? null,
        completedAt: build.completedAt?.toISOString() ?? null,
        createdAt: build.createdAt.toISOString(),
        updatedAt: build.updatedAt.toISOString(),
      })),
      builderAvailable: builders.length > 0,
      localBuilders: localNodes.map((node) => ({
        id: node.id,
        name: node.name,
        ready:
          !node.isDraining &&
          ['online', 'degraded'].includes(node.status) &&
          Boolean(node.lastHeartbeatAt && node.lastHeartbeatAt.getTime() >= Date.now() - 90_000) &&
          node.capabilities.includes('image-build') &&
          node.capabilities.includes('local-image-build'),
      })),
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

  async updateRegistry(
    registryId: string,
    input: UpdateContainerRegistryInput,
    actorUserId: string,
  ) {
    const now = new Date()
    const [registry] = await this.database
      .update(containerRegistries)
      .set({
        name: input.name,
        username: input.username,
        tokenEncrypted: encryptInfrastructureCredential(input.token),
        isActive: true,
        updatedAt: now,
      })
      .where(eq(containerRegistries.id, registryId))
      .returning({
        id: containerRegistries.id,
        name: containerRegistries.name,
        host: containerRegistries.host,
        username: containerRegistries.username,
        isActive: containerRegistries.isActive,
        createdAt: containerRegistries.createdAt,
        updatedAt: containerRegistries.updatedAt,
      })
    if (!registry) throw DomainError.notFound('Registry tidak ditemukan.')
    await this.database.insert(auditLogs).values({
      actorUserId,
      action: 'infrastructure.registry.credential-rotated',
      entityType: 'container_registry',
      entityId: registry.id,
      metadata: { host: registry.host, username: registry.username },
    })
    return serializeDates(registry)
  }

  async createApplication(input: CreateDeployableApplicationInput, actorUserId: string) {
    if (input.imageStorage === 'local') {
      const [node] = await this.database
        .select({ id: infrastructureNodes.id })
        .from(infrastructureNodes)
        .where(
          and(
            eq(infrastructureNodes.id, input.buildNodeId!),
            eq(infrastructureNodes.isActive, true),
            eq(infrastructureNodes.role, 'hybrid'),
          ),
        )
        .limit(1)
      if (!node)
        throw DomainError.validation(
          'Pilih server hybrid aktif untuk menyimpan dan menjalankan image lokal.',
        )
    } else {
      const [registry] = await this.database
        .select({ id: containerRegistries.id, host: containerRegistries.host })
        .from(containerRegistries)
        .where(
          and(
            eq(containerRegistries.id, input.registryId!),
            eq(containerRegistries.isActive, true),
          ),
        )
        .limit(1)
      if (!registry) throw DomainError.notFound('Registry tidak ditemukan atau tidak aktif.')
      if (!input.imageRepository?.startsWith(`${registry.host}/`)) {
        throw DomainError.validation(`Image repository harus berada di ${registry.host}.`)
      }
    }

    try {
      const [application] = await this.database
        .insert(deployableApplications)
        .values({
          ...input,
          imageRepository:
            input.imageStorage === 'local' ? `oc-local/${input.slug}` : input.imageRepository!,
          registryId: input.imageStorage === 'local' ? null : input.registryId,
          buildNodeId: input.imageStorage === 'local' ? input.buildNodeId : null,
          createdBy: actorUserId,
        })
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

  async receiveRelease(input: ReleaseCallbackInput, buildNodeId?: string) {
    const [application] = await this.database
      .select()
      .from(deployableApplications)
      .where(eq(deployableApplications.slug, input.applicationSlug))
      .limit(1)
    if (!application) throw DomainError.notFound('Application slug tidak ditemukan.')

    const release = await this.persistRelease(application, input, null, buildNodeId)
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
    buildNodeId?: string,
  ) {
    const local = application.imageStorage === 'local'
    if (local && (!buildNodeId || buildNodeId !== application.buildNodeId)) {
      throw DomainError.validation(
        'Release lokal hanya dapat dicatat dari hasil build pada server Application.',
      )
    }
    const imageReference = local
      ? input.imageDigest
      : `${application.imageRepository}@${input.imageDigest}`
    return this.database.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(applicationReleases)
        .values({
          applicationId: application.id,
          version: input.version,
          commitSha: input.commitSha,
          imageDigest: input.imageDigest,
          imageReference,
          localNodeId: local ? buildNodeId : null,
        })
        .onConflictDoNothing()
        .returning()

      const [releaseByVersion] = inserted
        ? [inserted]
        : await transaction
            .select()
            .from(applicationReleases)
            .where(
              and(
                eq(applicationReleases.applicationId, application.id),
                eq(applicationReleases.version, input.version),
              ),
            )
            .limit(1)
      if (releaseByVersion && releaseByVersion.imageDigest !== input.imageDigest) {
        throw DomainError.conflict('Versi release sudah menunjuk image digest yang berbeda.')
      }
      const [releaseByDigest] = releaseByVersion
        ? [releaseByVersion]
        : await transaction
            .select()
            .from(applicationReleases)
            .where(
              and(
                eq(applicationReleases.applicationId, application.id),
                eq(applicationReleases.imageDigest, input.imageDigest),
              ),
            )
            .limit(1)
      const release = releaseByVersion ?? releaseByDigest
      if (!release) throw DomainError.conflict('Release tidak dapat dicatat.')
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
    const source = releaseImageSource(release)
    const constrainedNodeIds = [
      ...new Set(
        resources
          .filter(
            (resource) =>
              release.localNodeId || resource.desiredSpec.secretDelivery === 'environment',
          )
          .map((resource) => resource.nodeId),
      ),
    ]
    if (constrainedNodeIds.length) {
      const nodes = await transaction
        .select({ id: infrastructureNodes.id, capabilities: infrastructureNodes.capabilities })
        .from(infrastructureNodes)
        .where(inArray(infrastructureNodes.id, constrainedNodeIds))
      const capabilities = new Map(nodes.map((node) => [node.id, node.capabilities]))
      for (const resource of resources) {
        validateLocalImageNode(source, resource.nodeId, capabilities.get(resource.nodeId) ?? [])
        validateSecretDelivery(
          resource.desiredSpec as ApplicationSpec,
          capabilities.get(resource.nodeId) ?? [],
        )
      }
    }
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
        source,
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
