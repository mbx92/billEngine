import { randomUUID } from 'node:crypto'
import type { ServiceStatus } from '../../../shared/constants/domain'
import { useDatabase, type Database } from '../../database/client'
import { InfrastructureRepository } from '../../repositories/infrastructure'
import { NativeInfrastructureRepository } from '../../repositories/native-infrastructure'
import { DomainError } from '../../utils/errors'
import { NativeInfrastructureService } from './native-service'

export interface InfrastructureLifecycleOperation {
  affectedCount: number
  rollback: () => Promise<boolean>
}

export class InfrastructureLifecycleService {
  private readonly native: NativeInfrastructureService

  constructor(
    database: Database = useDatabase(),
    private readonly repository = new InfrastructureRepository(database),
  ) {
    this.native = new NativeInfrastructureService(new NativeInfrastructureRepository(database))
  }

  async apply(
    serviceId: string,
    targetStatus: Extract<ServiceStatus, 'active' | 'suspended'>,
    actorUserId: string | null,
  ): Promise<InfrastructureLifecycleOperation> {
    if (!actorUserId) throw DomainError.invalidState('Actor lifecycle operation tidak tersedia.')
    const target = await this.repository.findServiceTarget(serviceId)
    if (!target) throw DomainError.notFound('Service tidak ditemukan.')
    if (target.resources.length === 0) return noLifecycleOperation()
    if (target.resources.some((resource) => resource.resourceType !== 'application')) {
      throw DomainError.invalidState('Suspend otomatis hanya mendukung application resource.')
    }

    const action = targetStatus === 'suspended' ? 'application.stop' : 'application.start'
    const rollbackAction = targetStatus === 'suspended' ? 'application.start' : 'application.stop'
    const completed: string[] = []

    for (const resource of target.resources) {
      await this.native.createLifecycleOperation(
        resource.id,
        action,
        actorUserId,
        `service:${serviceId}:${resource.id}:${randomUUID()}`,
      )
      completed.push(resource.id)
    }

    return {
      affectedCount: completed.length,
      rollback: async () => {
        const results = await Promise.allSettled(
          completed.map((resourceId) =>
            this.native.createLifecycleOperation(
              resourceId,
              rollbackAction,
              actorUserId,
              `service-rollback:${serviceId}:${resourceId}:${randomUUID()}`,
            ),
          ),
        )
        return results.every((result) => result.status === 'fulfilled')
      },
    }
  }
}

function noLifecycleOperation(): InfrastructureLifecycleOperation {
  return { affectedCount: 0, rollback: async () => true }
}
