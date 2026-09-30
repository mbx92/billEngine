import type { ServiceStatus } from '../../../shared/constants/domain'
import type { CoolifyClient } from '../../integrations/coolify/client'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'
import { useDatabase, type Database } from '../../database/client'
import { InfrastructureRepository } from '../../repositories/infrastructure'
import { DomainError } from '../../utils/errors'

type ClientFactory = (connection: {
  baseUrl: string
  tokenEncrypted: string | null
}) => CoolifyClient

export interface InfrastructureLifecycleOperation {
  affectedCount: number
  rollback: () => Promise<boolean>
}

export class InfrastructureLifecycleService {
  constructor(
    database: Database = useDatabase(),
    private readonly repository = new InfrastructureRepository(database),
    private readonly clientFactory: ClientFactory = clientForCoolifyConnection,
  ) {}

  async apply(
    serviceId: string,
    targetStatus: Extract<ServiceStatus, 'active' | 'suspended'>,
  ): Promise<InfrastructureLifecycleOperation> {
    const target = await this.repository.findServiceTarget(serviceId)
    if (!target) throw DomainError.notFound('Service tidak ditemukan.')
    if (target.resources.length === 0) return noLifecycleOperation()
    if (target.resources.some((resource) => resource.resourceType !== 'application')) {
      throw DomainError.invalidState(
        'Suspend otomatis saat ini hanya mendukung Coolify application.',
      )
    }

    const clients = new Map<string, CoolifyClient>()
    const completed: Array<{ client: CoolifyClient; uuid: string }> = []

    try {
      for (const resource of target.resources) {
        let client = clients.get(resource.serverId)
        if (!client) {
          client = this.clientFactory({
            baseUrl: resource.baseUrl,
            tokenEncrypted: resource.tokenEncrypted,
          })
          clients.set(resource.serverId, client)
        }

        if (targetStatus === 'suspended') await client.stopApplication(resource.coolifyUuid)
        else await client.startApplication(resource.coolifyUuid)
        completed.push({ client, uuid: resource.coolifyUuid })
      }
    } catch {
      const rollbackSucceeded = await compensate(completed, targetStatus)
      throw DomainError.external(
        rollbackSucceeded
          ? 'Coolify gagal mengubah seluruh resource; perubahan yang sempat berjalan sudah dibatalkan.'
          : 'Coolify gagal mengubah seluruh resource dan rollback tidak lengkap. Periksa resource secara manual.',
      )
    }

    return {
      affectedCount: completed.length,
      rollback: () => compensate(completed, targetStatus),
    }
  }
}

function noLifecycleOperation(): InfrastructureLifecycleOperation {
  return { affectedCount: 0, rollback: async () => true }
}

async function compensate(
  completed: Array<{ client: CoolifyClient; uuid: string }>,
  appliedStatus: Extract<ServiceStatus, 'active' | 'suspended'>,
) {
  const results = await Promise.allSettled(
    [...completed]
      .reverse()
      .map(({ client, uuid }) =>
        appliedStatus === 'suspended'
          ? client.startApplication(uuid)
          : client.stopApplication(uuid),
      ),
  )
  return results.every((result) => result.status === 'fulfilled')
}
