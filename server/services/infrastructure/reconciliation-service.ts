import { createHash } from 'node:crypto'
import type { ApplyInfrastructureInput } from '../../../shared/schemas/services'
import type {
  ApiInfrastructureReconciliationPreview,
  ApiInfrastructureReconciliationResult,
} from '../../../shared/types/api'
import type { CoolifyClient } from '../../integrations/coolify/client'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository, JobRunRepository } from '../../repositories/audit'
import { InfrastructureRepository } from '../../repositories/infrastructure'
import { DomainError } from '../../utils/errors'
import { CoolifyResourceService } from '../coolify/resource-service'
import { buildReconciliationTargets } from './reconciliation-plan'

interface ReconciliationActor {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

type ClientFactory = (connection: {
  baseUrl: string
  tokenEncrypted: string | null
}) => CoolifyClient

export class InfrastructureReconciliationService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly repository = new InfrastructureRepository(database),
    private readonly audit = new AuditLogRepository(database),
    private readonly jobs = new JobRunRepository(database),
    private readonly resourceService = new CoolifyResourceService(database),
    private readonly clientFactory: ClientFactory = clientForCoolifyConnection,
  ) {}

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
    const lockConnection = await this.database.$client.connect()
    let lockAcquired = false

    try {
      const lock = await lockConnection.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)) as acquired',
        [`infrastructure:${serviceId}`],
      )
      lockAcquired = lock.rows[0]?.acquired ?? false
      if (!lockAcquired) {
        throw DomainError.conflict('Rekonsiliasi service ini sedang berjalan.')
      }

      const initialPreview = await this.preview(serviceId)
      if (initialPreview.fingerprint !== input.fingerprint) {
        throw DomainError.conflict(
          'Konfigurasi berubah sejak preview. Muat ulang lalu coba kembali.',
        )
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
      const clients = new Map<string, CoolifyClient>()
      const touchedServers = new Set<string>()
      const results: ApiInfrastructureReconciliationResult['resources'] = []
      let updatedCount = 0
      let restartedCount = 0
      let failedCount = 0
      const job = await this.jobs.start('coolify.infrastructure.reconcile')

      try {
        for (const resource of target.resources) {
          const desired = plannedById.get(resource.id)!
          if (!desired.changed) continue

          try {
            let client = clients.get(resource.serverId)
            if (!client) {
              client = this.clientFactory({
                baseUrl: resource.baseUrl,
                tokenEncrypted: resource.tokenEncrypted,
              })
              clients.set(resource.serverId, client)
            }

            await client.updateApplicationLimits(resource.coolifyUuid, {
              ...(desired.desiredCpuCores !== null ? { cpuCores: desired.desiredCpuCores } : {}),
              ...(desired.desiredMemoryBytes !== null
                ? { memoryBytes: desired.desiredMemoryBytes }
                : {}),
            })
            updatedCount += 1
            touchedServers.add(resource.serverId)

            if (input.restartRunning && resource.status === 'running') {
              try {
                await client.restartApplication(resource.coolifyUuid)
                restartedCount += 1
                results.push({
                  id: resource.id,
                  name: resource.name,
                  status: 'restart_queued',
                  message: null,
                })
              } catch (error) {
                failedCount += 1
                results.push({
                  id: resource.id,
                  name: resource.name,
                  status: 'failed',
                  message: `Limit tersimpan, tetapi restart gagal${coolifyStatusSuffix(error)}.`,
                })
              }
            } else {
              results.push({
                id: resource.id,
                name: resource.name,
                status: 'updated',
                message:
                  resource.status === 'running'
                    ? 'Limit tersimpan tanpa restart; aktif setelah deployment atau restart berikutnya.'
                    : 'Limit tersimpan dan aktif saat resource dijalankan kembali.',
              })
            }
          } catch (error) {
            failedCount += 1
            results.push({
              id: resource.id,
              name: resource.name,
              status: 'failed',
              message: `Update Coolify gagal${coolifyStatusSuffix(error)}.`,
            })
          }
        }

        let verificationFailed = false
        for (const serverId of touchedServers) {
          try {
            await this.resourceService.syncServer(serverId, actor.userId)
          } catch {
            verificationFailed = true
          }
        }

        const status =
          failedCount === 0 && !verificationFailed
            ? 'completed'
            : updatedCount > 0
              ? 'partial'
              : 'failed'

        await this.database.transaction(async (transaction) => {
          await this.audit.record(transaction, {
            actorUserId: actor.userId,
            action: 'service.infrastructure.reconciled',
            entityType: 'service',
            entityId: serviceId,
            beforeData: initialPreview.resources.map((resource) => ({
              id: resource.id,
              cpuCores: resource.currentCpuCores,
              memoryBytes: resource.currentMemoryBytes,
            })),
            afterData: initialPreview.resources.map((resource) => ({
              id: resource.id,
              cpuCores: resource.desiredCpuCores,
              memoryBytes: resource.desiredMemoryBytes,
            })),
            metadata: {
              status,
              updatedCount,
              restartedCount,
              failedCount,
              verificationFailed,
            },
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
          })
        })

        await this.jobs.finish(job.id, {
          status: status === 'failed' ? 'failed' : 'completed',
          processedCount: updatedCount,
          errorMessage: status === 'failed' ? 'Tidak ada resource yang berhasil diperbarui.' : null,
          metadata: { serviceId, status, restartedCount, failedCount, verificationFailed },
        })

        return {
          status,
          updatedCount,
          restartedCount,
          failedCount,
          verificationFailed,
          resources: results,
          preview: await this.preview(serviceId),
        }
      } catch (error) {
        await this.jobs
          .finish(job.id, {
            status: 'failed',
            processedCount: updatedCount,
            errorMessage: 'Rekonsiliasi infrastructure gagal.',
            metadata: { serviceId, restartedCount, failedCount },
          })
          .catch(() => undefined)
        throw error
      }
    } finally {
      if (lockAcquired) {
        await lockConnection
          .query('select pg_advisory_unlock(hashtext($1))', [`infrastructure:${serviceId}`])
          .catch(() => undefined)
      }
      lockConnection.release()
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
  if (target.resources.length === 0) return 'Hubungkan resource Coolify ke service terlebih dahulu.'
  if (target.planResourceCount !== null && target.planResourceCount !== target.resources.length) {
    return `Plan membutuhkan ${target.planResourceCount} resource, tetapi ${target.resources.length} resource terhubung.`
  }
  if (target.resources.some((resource) => !resource.serverActive)) {
    return 'Salah satu koneksi Coolify tidak aktif.'
  }
  if (target.resources.some((resource) => resource.resourceType !== 'application')) {
    return 'Penerapan otomatis saat ini hanya mendukung Coolify application.'
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

function coolifyStatusSuffix(error: unknown) {
  return error instanceof CoolifyClientError && error.statusCode
    ? ` (HTTP ${error.statusCode})`
    : ''
}
