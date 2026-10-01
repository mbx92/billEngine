import { and, asc, eq } from 'drizzle-orm'
import type { ApiResourceDomain } from '../../shared/types/api'
import { useDatabase, type Database } from '../database/client'
import { coolifyResources, coolifyServers, resourceDomains } from '../database/schema'

export class ResourceDomainRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findResourceTarget(resourceId: string) {
    const rows = await this.database
      .select({
        id: coolifyResources.id,
        name: coolifyResources.name,
        resourceType: coolifyResources.resourceType,
        coolifyUuid: coolifyResources.coolifyUuid,
        serverId: coolifyServers.id,
        serverName: coolifyServers.name,
        baseUrl: coolifyServers.baseUrl,
        tokenEncrypted: coolifyServers.tokenEncrypted,
        serverActive: coolifyServers.isActive,
      })
      .from(coolifyResources)
      .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
      .where(eq(coolifyResources.id, resourceId))
      .limit(1)

    return rows[0] ?? null
  }

  async list(resourceId: string): Promise<ApiResourceDomain[]> {
    const rows = await this.database
      .select()
      .from(resourceDomains)
      .where(eq(resourceDomains.resourceId, resourceId))
      .orderBy(asc(resourceDomains.hostname))

    return rows.map(serializeDomain)
  }

  async findByHostname(hostname: string) {
    const rows = await this.database
      .select()
      .from(resourceDomains)
      .where(eq(resourceDomains.hostname, hostname))
      .limit(1)
    return rows[0] ?? null
  }

  async findById(resourceId: string, domainId: string) {
    const rows = await this.database
      .select()
      .from(resourceDomains)
      .where(and(eq(resourceDomains.resourceId, resourceId), eq(resourceDomains.id, domainId)))
      .limit(1)
    return rows[0] ?? null
  }

  async create(input: {
    resourceId: string
    hostname: string
    type: 'platform' | 'custom'
    isPrimary: boolean
    cnameTarget: string | null
    composeServiceName?: string
  }) {
    return this.database.transaction(async (transaction) => {
      if (input.isPrimary) {
        await transaction
          .update(resourceDomains)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(eq(resourceDomains.resourceId, input.resourceId))
      }

      const rows = await transaction
        .insert(resourceDomains)
        .values({ ...input, status: 'configuring' })
        .returning()
      return rows[0]!
    })
  }

  async updateProvider(
    id: string,
    input: {
      providerHostnameId: string
      providerHostnameStatus: string
      providerSslStatus: string
      verificationRecords: Array<{ type: string; name: string; value: string }>
    },
  ) {
    const rows = await this.database
      .update(resourceDomains)
      .set({
        ...input,
        status: domainStatus(input),
        updatedAt: new Date(),
        lastCheckedAt: new Date(),
      })
      .where(eq(resourceDomains.id, id))
      .returning()
    return rows[0]!
  }

  async updateComposeServiceName(id: string, composeServiceName: string | null) {
    await this.database
      .update(resourceDomains)
      .set({ composeServiceName, updatedAt: new Date() })
      .where(eq(resourceDomains.id, id))
  }

  async updateStatus(
    id: string,
    status: 'pending' | 'configuring' | 'verifying' | 'active' | 'failed',
    lastError: string | null = null,
  ) {
    const rows = await this.database
      .update(resourceDomains)
      .set({ status, lastError, lastCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(resourceDomains.id, id))
      .returning()
    return rows[0]!
  }

  async delete(id: string) {
    await this.database.delete(resourceDomains).where(eq(resourceDomains.id, id))
  }
}

function domainStatus(input: { providerHostnameStatus: string; providerSslStatus: string }) {
  return input.providerHostnameStatus === 'active' && input.providerSslStatus === 'active'
    ? ('active' as const)
    : ('verifying' as const)
}

export function serializeDomain(row: typeof resourceDomains.$inferSelect): ApiResourceDomain {
  return {
    id: row.id,
    resourceId: row.resourceId,
    hostname: row.hostname,
    type: row.type,
    status: row.status,
    isPrimary: row.isPrimary,
    cnameTarget: row.cnameTarget,
    providerHostnameStatus: row.providerHostnameStatus,
    providerSslStatus: row.providerSslStatus,
    verificationRecords: row.verificationRecords ?? [],
    composeServiceName: row.composeServiceName,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
