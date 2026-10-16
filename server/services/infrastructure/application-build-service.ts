import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { OperationStatusUpdateInput } from '../../../shared/schemas/infrastructure'
import {
  createApplicationReleaseSchema,
  type QueueApplicationBuildInput,
} from '../../../shared/schemas/releases'
import { useDatabase, type Database } from '../../database/client'
import {
  applicationBuilds,
  auditLogs,
  containerRegistries,
  deployableApplications,
  infrastructureNodes,
  infrastructureOperations,
} from '../../database/schema'
import { decryptInfrastructureCredential } from '../../utils/credentials'
import { DomainError } from '../../utils/errors'
import { InfrastructureReleaseService } from './release-service'

export class ApplicationBuildService {
  constructor(private readonly database: Database = useDatabase()) {}

  async queue(
    applicationId: string,
    input: QueueApplicationBuildInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    return this.database.transaction(async (transaction) => {
      const [existingOperation] = await transaction
        .select()
        .from(infrastructureOperations)
        .where(eq(infrastructureOperations.idempotencyKey, idempotencyKey))
        .limit(1)
      if (existingOperation) {
        const [existingBuild] = await transaction
          .select()
          .from(applicationBuilds)
          .where(eq(applicationBuilds.operationId, existingOperation.id))
          .limit(1)
        if (!existingBuild || existingBuild.applicationId !== applicationId) {
          throw DomainError.conflict('Idempotency key sudah digunakan operation lain.')
        }
        return {
          build: serializeBuild(existingBuild),
          operation: existingOperation,
          replayed: true,
        }
      }

      const [application] = await transaction
        .select({
          id: deployableApplications.id,
          repositoryUrl: deployableApplications.repositoryUrl,
          defaultBranch: deployableApplications.defaultBranch,
          dockerfilePath: deployableApplications.dockerfilePath,
          buildContext: deployableApplications.buildContext,
          imageRepository: deployableApplications.imageRepository,
          registryHost: containerRegistries.host,
        })
        .from(deployableApplications)
        .innerJoin(
          containerRegistries,
          eq(containerRegistries.id, deployableApplications.registryId),
        )
        .where(
          and(eq(deployableApplications.id, applicationId), eq(containerRegistries.isActive, true)),
        )
        .limit(1)
        .for('update')
      if (!application)
        throw DomainError.notFound('Application atau registry aktif tidak ditemukan.')
      if (!application.repositoryUrl.startsWith('https://github.com/')) {
        throw DomainError.validation(
          'Native builder saat ini hanya menerima repository HTTPS github.com.',
        )
      }
      if (!application.imageRepository.startsWith(`${application.registryHost}/`)) {
        throw DomainError.invalidState('Image repository tidak cocok dengan registry Application.')
      }

      const [activeBuild] = await transaction
        .select({ id: applicationBuilds.id })
        .from(applicationBuilds)
        .where(
          and(
            eq(applicationBuilds.applicationId, applicationId),
            inArray(applicationBuilds.status, ['queued', 'running']),
          ),
        )
        .limit(1)
      if (activeBuild) throw DomainError.conflict('Application masih memiliki build aktif.')

      const [builder] = await transaction
        .select({ id: infrastructureNodes.id })
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
        )
        .orderBy(
          asc(sql`coalesce(${infrastructureNodes.diskUsageBasisPoints}, 0)`),
          asc(infrastructureNodes.name),
        )
        .limit(1)
        .for('update', { skipLocked: true })
      if (!builder) {
        throw DomainError.invalidState(
          'Tidak ada builder node online dengan capability image-build.',
        )
      }

      const buildId = randomUUID()
      const operationId = randomUUID()
      const version = input.version || generatedVersion(buildId)
      const now = new Date()
      const [operation] = await transaction
        .insert(infrastructureOperations)
        .values({
          id: operationId,
          nodeId: builder.id,
          actorUserId,
          idempotencyKey,
          action: 'application.build',
          maxAttempts: 2,
          expiresAt: new Date(now.getTime() + 6 * 60 * 60_000),
          payload: {
            buildId,
            repositoryUrl: application.repositoryUrl,
            revision: application.defaultBranch,
            dockerfilePath: application.dockerfilePath,
            buildContext: application.buildContext,
            imageRepository: application.imageRepository,
            version,
          },
        })
        .returning()
      if (!operation) throw new Error('Failed to create application build operation.')

      const [build] = await transaction
        .insert(applicationBuilds)
        .values({
          id: buildId,
          applicationId,
          nodeId: builder.id,
          operationId,
          version,
          createdBy: actorUserId,
        })
        .returning()
      if (!build) throw new Error('Failed to create application build.')

      await transaction.insert(auditLogs).values({
        actorUserId,
        action: 'infrastructure.application-build.queued',
        entityType: 'application_build',
        entityId: build.id,
        metadata: {
          applicationId,
          nodeId: builder.id,
          operationId,
          version,
          repositoryUrl: application.repositoryUrl,
          revision: application.defaultBranch,
        },
      })
      return { build: serializeBuild(build), operation, replayed: false }
    })
  }

  async synchronizeOperation(
    operationId: string,
    input: OperationStatusUpdateInput,
    effectiveStatus: string,
  ) {
    const [record] = await this.database
      .select({
        build: applicationBuilds,
        applicationSlug: deployableApplications.slug,
      })
      .from(applicationBuilds)
      .innerJoin(
        deployableApplications,
        eq(deployableApplications.id, applicationBuilds.applicationId),
      )
      .where(eq(applicationBuilds.operationId, operationId))
      .limit(1)
    if (!record) throw DomainError.notFound('Build untuk operation tidak ditemukan.')

    const now = new Date()
    if (effectiveStatus === 'running') {
      await this.database
        .update(applicationBuilds)
        .set({ status: 'running', startedAt: record.build.startedAt ?? now, updatedAt: now })
        .where(eq(applicationBuilds.id, record.build.id))
      return
    }
    if (effectiveStatus === 'queued') {
      await this.database
        .update(applicationBuilds)
        .set({
          status: 'queued',
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          updatedAt: now,
        })
        .where(eq(applicationBuilds.id, record.build.id))
      return
    }
    if (effectiveStatus === 'failed') {
      await this.database
        .update(applicationBuilds)
        .set({
          status: 'failed',
          errorCode: input.errorCode ?? 'image_build_failed',
          errorMessage: input.errorMessage ?? 'Build image gagal.',
          logExcerpt: input.errorMessage?.slice(-8000),
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(applicationBuilds.id, record.build.id))
      return
    }
    if (effectiveStatus !== 'succeeded') return

    const result = input.result ?? {}
    if (result.buildId !== record.build.id || result.version !== record.build.version) {
      await this.failFinalization(
        record.build.id,
        'build_result_mismatch',
        'Identitas hasil build tidak cocok.',
      )
      return
    }
    const releaseInput = createApplicationReleaseSchema.safeParse({
      version: result.version,
      commitSha: result.commitSha,
      imageDigest: result.imageDigest,
    })
    if (!releaseInput.success) {
      await this.failFinalization(
        record.build.id,
        'build_result_invalid',
        'Digest atau commit hasil build tidak valid.',
      )
      return
    }

    try {
      const released = await new InfrastructureReleaseService(this.database).receiveRelease({
        applicationSlug: record.applicationSlug,
        ...releaseInput.data,
      })
      await this.database
        .update(applicationBuilds)
        .set({
          status: 'succeeded',
          releaseId: released.release.id,
          commitSha: releaseInput.data.commitSha,
          imageDigest: releaseInput.data.imageDigest,
          imageReference: released.release.imageReference,
          logExcerpt: typeof result.logExcerpt === 'string' ? result.logExcerpt.slice(-8000) : null,
          errorCode: null,
          errorMessage: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(applicationBuilds.id, record.build.id))
    } catch (error) {
      await this.failFinalization(
        record.build.id,
        'release_registration_failed',
        error instanceof Error ? error.message : 'Release hasil build tidak dapat dicatat.',
      )
    }
  }

  async registryCredentialForOperation(nodeId: string, operationId: string) {
    const [record] = await this.database
      .select({
        action: infrastructureOperations.action,
        imageRepository: deployableApplications.imageRepository,
        host: containerRegistries.host,
        username: containerRegistries.username,
        tokenEncrypted: containerRegistries.tokenEncrypted,
      })
      .from(infrastructureOperations)
      .innerJoin(applicationBuilds, eq(applicationBuilds.operationId, infrastructureOperations.id))
      .innerJoin(
        deployableApplications,
        eq(deployableApplications.id, applicationBuilds.applicationId),
      )
      .innerJoin(containerRegistries, eq(containerRegistries.id, deployableApplications.registryId))
      .where(
        and(
          eq(infrastructureOperations.id, operationId),
          eq(infrastructureOperations.nodeId, nodeId),
          inArray(infrastructureOperations.status, ['dispatched', 'running']),
          eq(containerRegistries.isActive, true),
          isNull(applicationBuilds.completedAt),
        ),
      )
      .limit(1)
    if (!record || record.action !== 'application.build') return null
    if (!record.imageRepository.startsWith(`${record.host}/`)) {
      throw DomainError.invalidState('Image build tidak cocok dengan registry Application.')
    }
    return {
      host: record.host,
      username: record.username,
      token: decryptInfrastructureCredential(record.tokenEncrypted),
    }
  }

  private async failFinalization(buildId: string, code: string, message: string) {
    await this.database
      .update(applicationBuilds)
      .set({
        status: 'failed',
        errorCode: code,
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(applicationBuilds.id, buildId))
  }
}

function generatedVersion(buildId: string) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  return `build-${timestamp}-${buildId.slice(0, 8)}`
}

function serializeBuild<T extends typeof applicationBuilds.$inferSelect>(build: T) {
  return {
    ...build,
    startedAt: build.startedAt?.toISOString() ?? null,
    completedAt: build.completedAt?.toISOString() ?? null,
    createdAt: build.createdAt.toISOString(),
    updatedAt: build.updatedAt.toISOString(),
  }
}
