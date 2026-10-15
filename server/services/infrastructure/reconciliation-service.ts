import { createHash, randomUUID } from 'node:crypto'
import type { ApplyInfrastructureInput } from '../../../shared/schemas/services'
import type {
  ApiInfrastructureReconciliationPreview,
  ApiInfrastructureReconciliationResult,
} from '../../../shared/types/api'
import type { ApplicationSpec } from '../../../shared/schemas/infrastructure'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository, JobRunRepository } from '../../repositories/audit'
import { InfrastructureRepository } from '../../repositories/infrastructure'
import { NativeInfrastructureRepository } from '../../repositories/native-infrastructure'
import { DomainError } from '../../utils/errors'
import { buildReconciliationTargets } from './reconciliation-plan'
import { NativeInfrastructureService } from './native-service'

interface ReconciliationActor {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export class InfrastructureReconciliationService {
  private readonly native: NativeInfrastructureService

  constructor(
    private readonly database: Database = useDatabase(),
    private readonly repository = new InfrastructureRepository(database),
    private readonly audit = new AuditLogRepository(database),
    private readonly jobs = new JobRunRepository(database),
  ) {
    this.native = new NativeInfrastructureService(new NativeInfrastructureRepository(database))
  }

  async preview(serviceId: string): Promise<ApiInfrastructureReconciliationPreview> {
    const target = await this.repository.findServiceTarget(serviceId)
    if (!target) throw DomainError.notFound('Service tidak ditemukan.')

    const planned = buildReconciliationTargets(
      target.resources.map((resource) => ({
        id: resource.id,
        cpuCores: resource.limitsCpus,
        memoryBytes: resource.limitsMemoryBytes,
      })),
      target.planCpuCores,
      target.planMemoryBytes,
    )
    const plannedById = new Map(planned.map((resource) => [resource.id, resource]))
    const resources = target.resources.map((resource) => {
      const desired = plannedById.get(resource.id)!
      return {
        id: resource.id,
        name: resource.name,
        status: resource.status,
        resourceType: resource.resourceType,
        serverName: resource.serverName,
        currentCpuCores: resource.limitsCpus,
        desiredCpuCores: desired.desiredCpuCores,
        currentMemoryBytes: resource.limitsMemoryBytes?.toString() ?? null,
        desiredMemoryBytes: desired.desiredMemoryBytes?.toString() ?? null,
        changed: desired.changed,
      }
    })

    const blockingReason = reconciliationBlock(target, planned)
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          serviceId: target.id,
          serviceUpdatedAt: target.updatedAt.toISOString(),
          quota: {
            resourceCount: target.planResourceCount,
            cpuCores: target.planCpuCores,
            memoryBytes: target.planMemoryBytes?.toString() ?? null,
          },
          resources: target.resources.map((resource) => ({
            id: resource.id,
            updatedAt: resource.resourceUpdatedAt.toISOString(),
            cpuCores: resource.limitsCpus,
            memoryBytes: resource.limitsMemoryBytes?.toString() ?? null,
          })),
        }),
      )
      .digest('hex')

    return {
      serviceId: target.id,
      serviceNumber: target.serviceNumber,
      serviceName: target.name,
      planName: target.planName,
      canApply: blockingReason === null,
      blockingReason,
      fingerprint,
      restartRequired: resources.some(
        (resource) => resource.changed && resource.status === 'running',
      ),
      expectedResourceCount: target.planResourceCount,
      actualResourceCount: resources.length,
      resources,
    }
  }

  async apply(
    serviceId: string,
    input: ApplyInfrastructureInput,
    actor: ReconciliationActor,
  ): Promise<ApiInfrastructureReconciliationResult> {
    if (!actor.userId) throw DomainError.invalidState('Actor reconciliation tidak tersedia.')
    const initialPreview = await this.preview(serviceId)
    if (initialPreview.fingerprint !== input.fingerprint) {
      throw DomainError.conflict('Konfigurasi berubah sejak preview. Muat ulang lalu coba kembali.')
    }
    if (!initialPreview.canApply) {
      throw DomainError.invalidState(
        initialPreview.blockingReason ?? 'Infrastructure tidak dapat diterapkan.',
      )
    }

    const target = await this.repository.findServiceTarget(serviceId)
    if (!target) throw DomainError.notFound('Service tidak ditemukan.')
    const planned = buildReconciliationTargets(
      target.resources.map((resource) => ({
        id: resource.id,
        cpuCores: resource.limitsCpus,
        memoryBytes: resource.limitsMemoryBytes,
      })),
      target.planCpuCores,
      target.planMemoryBytes,
    )
    const plannedById = new Map(planned.map((resource) => [resource.id, resource]))
    const results: ApiInfrastructureReconciliationResult['resources'] = []
    let updatedCount = 0
    let restartedCount = 0
    let failedCount = 0
    const job = await this.jobs.start('infrastructure.reconcile')

    for (const resource of target.resources) {
      const desired = plannedById.get(resource.id)!
      if (!desired.changed) continue

      try {
        const spec = resource.desiredSpec as ApplicationSpec
        await this.native.updateApplication(
          resource.id,
          {
            name: resource.name,
            classification: resource.classification,
            spec: {
              ...spec,
              limits: {
                cpuMilli: decimalToMilli(desired.desiredCpuCores),
                memoryBytes: desired.desiredMemoryBytes?.toString() ?? spec.limits.memoryBytes,
              },
            },
          },
          actor.userId,
          `reconcile:${serviceId}:${resource.id}:${randomUUID()}`,
        )
        updatedCount += 1
        if (resource.status === 'running') restartedCount += 1
        results.push({
          id: resource.id,
          name: resource.name,
          status: resource.status === 'running' ? 'restart_queued' : 'updated',
          message: 'Perubahan limit masuk antrean deployment OC Agent.',
        })
      } catch (error) {
        failedCount += 1
        results.push({
          id: resource.id,
          name: resource.name,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Operation gagal dijadwalkan.',
        })
      }
    }

    const resultStatus =
      failedCount === 0 ? 'completed' : updatedCount > 0 ? 'partial' : ('failed' as const)
    await this.database.transaction(async (transaction) => {
      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'service.infrastructure.reconciled',
        entityType: 'service',
        entityId: serviceId,
        beforeData: initialPreview.resources,
        afterData: results,
        metadata: { status: resultStatus, updatedCount, restartedCount, failedCount },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })
    })
    await this.jobs.finish(job.id, {
      status: resultStatus === 'failed' ? 'failed' : 'completed',
      processedCount: updatedCount,
      errorMessage:
        resultStatus === 'failed' ? 'Tidak ada operation yang berhasil dijadwalkan.' : null,
      metadata: { serviceId, status: resultStatus, restartedCount, failedCount },
    })

    return {
      status: resultStatus,
      updatedCount,
      restartedCount,
      failedCount,
      verificationFailed: false,
      resources: results,
      preview: await this.preview(serviceId),
    }
  }
}

function reconciliationBlock(
  target: Awaited<ReturnType<InfrastructureRepository['findServiceTarget']>> & {},
  planned: ReturnType<typeof buildReconciliationTargets>,
): string | null {
  if (target.status === 'cancelled') return 'Service yang dibatalkan tidak dapat direkonsiliasi.'
  if (target.planCpuCores === null && target.planMemoryBytes === null) {
    return 'Plan service belum memiliki quota CPU atau RAM.'
  }
  if (target.resources.length === 0) return 'Hubungkan infrastructure resource ke service dahulu.'
  if (target.planResourceCount !== null && target.planResourceCount !== target.resources.length) {
    return `Plan membutuhkan ${target.planResourceCount} resource, tetapi ${target.resources.length} resource terhubung.`
  }
  if (target.resources.some((resource) => !resource.serverActive)) {
    return 'Salah satu server OC Agent tidak aktif.'
  }
  if (target.resources.some((resource) => resource.resourceType !== 'application')) {
    return 'Penerapan otomatis hanya mendukung application resource.'
  }
  if (
    planned.some(
      (resource) => resource.desiredCpuCores === '0' || resource.desiredMemoryBytes === 0n,
    )
  ) {
    return 'Quota terlalu kecil untuk dibagi ke seluruh resource yang terhubung.'
  }
  if (planned.every((resource) => !resource.changed)) {
    return 'Seluruh resource sudah sesuai dengan plan.'
  }
  return null
}

function decimalToMilli(value: string | null) {
  if (!value) return 50
  const [whole = '0', fraction = ''] = value.split('.')
  return Number(BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, '0').slice(0, 3)))
}
