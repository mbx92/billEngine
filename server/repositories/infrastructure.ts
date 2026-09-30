import { asc, eq } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import { coolifyResources, coolifyServers, serviceResources, services } from '../database/schema'

export class InfrastructureRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findServiceTarget(serviceId: string) {
    const [service] = await this.database
      .select({
        id: services.id,
        serviceNumber: services.serviceNumber,
        name: services.name,
        status: services.status,
        planName: services.planName,
        planResourceCount: services.planResourceCount,
        planCpuCores: services.planCpuCores,
        planMemoryBytes: services.planMemoryBytes,
        updatedAt: services.updatedAt,
      })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1)

    if (!service) return null

    const resources = await this.database
      .select({
        id: coolifyResources.id,
        name: coolifyResources.name,
        status: coolifyResources.status,
        resourceType: coolifyResources.resourceType,
        coolifyUuid: coolifyResources.coolifyUuid,
        limitsCpus: coolifyResources.limitsCpus,
        limitsMemoryBytes: coolifyResources.limitsMemoryBytes,
        resourceUpdatedAt: coolifyResources.updatedAt,
        serverId: coolifyServers.id,
        serverName: coolifyServers.name,
        baseUrl: coolifyServers.baseUrl,
        tokenEncrypted: coolifyServers.tokenEncrypted,
        serverActive: coolifyServers.isActive,
      })
      .from(serviceResources)
      .innerJoin(coolifyResources, eq(coolifyResources.id, serviceResources.resourceId))
      .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
      .where(eq(serviceResources.serviceId, serviceId))
      .orderBy(asc(coolifyResources.id))

    return { ...service, resources }
  }
}
