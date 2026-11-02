import { eq } from 'drizzle-orm'
import { useDatabase } from '../database/client'
import {
  coolifyNodes,
  coolifyResources,
  coolifyServers,
  serviceResources,
} from '../database/schema'
import { SettingsRepository } from './settings'
import { AuditLogRepository } from './audit'
import type { SettingsActorContext } from '../services/settings/settings-service'

export class GatewayRepository {
  constructor(private readonly database = useDatabase()) {}

  async nodeTarget(id: string) {
    const [row] = await this.database
      .select({ node: coolifyNodes, server: coolifyServers })
      .from(coolifyNodes)
      .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyNodes.coolifyServerId))
      .where(eq(coolifyNodes.id, id))
      .limit(1)
    return row ?? null
  }

  async target(id: string) {
    const [row] = await this.database
      .select({ resource: coolifyResources, server: coolifyServers })
      .from(coolifyResources)
      .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
      .where(eq(coolifyResources.id, id))
      .limit(1)
    return row ?? null
  }

  async serviceIds(id: string) {
    const rows = await this.database
      .select({ id: serviceResources.serviceId })
      .from(serviceResources)
      .where(eq(serviceResources.resourceId, id))
    return rows.map((row) => row.id)
  }

  async read(key: string) {
    return (await new SettingsRepository(this.database).findByKey(key))?.value
  }

  async save(key: string, value: unknown, resourceId: string | null, actor: SettingsActorContext) {
    return this.database.transaction(async (transaction) => {
      await new SettingsRepository(this.database).upsert(transaction, key, value)
      await new AuditLogRepository(this.database).record(transaction, {
        actorUserId: actor.userId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        action: resourceId ? 'resource.gateway.updated' : 'gateway.settings.updated',
        entityType: resourceId ? 'coolify_resource' : 'settings',
        entityId: resourceId,
        afterData: value,
      })
    })
  }
}
