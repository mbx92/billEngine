import { and, asc, eq, isNull } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  infrastructureNodes,
  infrastructureResources,
  serviceResources,
  services,
} from '../database/schema'

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

    const rows = await this.database
      .select({
        id: infrastructureResources.id,
        name: infrastructureResources.name,
        status: infrastructureResources.observedState,
        resourceType: infrastructureResources.kind,
        classification: infrastructureResources.classification,
        desiredSpec: infrastructureResources.desiredSpec,
        resourceUpdatedAt: infrastructureResources.updatedAt,
        nodeId: infrastructureNodes.id,
        serverName: infrastructureNodes.name,
        serverActive: infrastructureNodes.isActive,
      })
      .from(serviceResources)
      .innerJoin(
        infrastructureResources,
        eq(infrastructureResources.id, serviceResources.resourceId),
      )
      .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
      .where(
        and(eq(serviceResources.serviceId, serviceId), isNull(infrastructureResources.deletedAt)),
      )
      .orderBy(asc(infrastructureResources.id))

    const resources = rows.map((resource) => ({
      ...resource,
      ...resourceLimits(resource.desiredSpec),
    }))

    return { ...service, resources }
  }
}

function resourceLimits(desiredSpec: Record<string, unknown>) {
  const limits = (desiredSpec as { limits?: { cpuMilli?: number; memoryBytes?: string } }).limits
  return {
    limitsCpus: limits?.cpuMilli === undefined ? null : milliToDecimal(limits.cpuMilli),
    limitsMemoryBytes: limits?.memoryBytes ? BigInt(limits.memoryBytes) : null,
  }
}

function milliToDecimal(value: number) {
  const whole = Math.floor(value / 1000)
  const fraction = String(value % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}
