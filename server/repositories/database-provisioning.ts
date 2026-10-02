import { and, count, eq, isNull, ne } from 'drizzle-orm'
import type {
  CreateDatabaseClusterInput,
  UpdateDatabaseClusterInput,
} from '../../shared/schemas/database-provisioning'
import type { ApiDatabaseCluster, ApiServiceDatabase } from '../../shared/types/api'
import { useDatabase, type Database } from '../database/client'
import { coolifyServers, databaseClusters, serviceDatabases } from '../database/schema'
import { encryptInfrastructureCredential } from '../utils/credentials'

export class DatabaseProvisioningRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async listClusters(): Promise<ApiDatabaseCluster[]> {
    const rows = await this.database
      .select({
        cluster: databaseClusters,
        coolifyServerName: coolifyServers.name,
        activeDatabaseCount: count(serviceDatabases.id),
      })
      .from(databaseClusters)
      .innerJoin(coolifyServers, eq(coolifyServers.id, databaseClusters.coolifyServerId))
      .leftJoin(
        serviceDatabases,
        and(
          eq(serviceDatabases.databaseClusterId, databaseClusters.id),
          isNull(serviceDatabases.deletedAt),
          ne(serviceDatabases.status, 'deleted'),
        ),
      )
      .groupBy(databaseClusters.id, coolifyServers.name)
      .orderBy(databaseClusters.name)

    return rows.map(({ cluster, coolifyServerName, activeDatabaseCount }) => ({
      id: cluster.id,
      coolifyServerId: cluster.coolifyServerId,
      coolifyServerName,
      name: cluster.name,
      engine: 'postgresql',
      host: cluster.host,
      port: cluster.port,
      adminDatabase: cluster.adminDatabase,
      provisionerUsername: cluster.provisionerUsername,
      sslMode: cluster.sslMode as ApiDatabaseCluster['sslMode'],
      defaultConnectionLimit: cluster.defaultConnectionLimit,
      isActive: cluster.isActive,
      hasCredential: Boolean(cluster.credentialEncrypted),
      activeDatabaseCount: Number(activeDatabaseCount),
      totalDatabaseCount: null,
      connectionStatus: 'unchecked',
      createdAt: cluster.createdAt.toISOString(),
      updatedAt: cluster.updatedAt.toISOString(),
    }))
  }

  async listActiveClusters() {
    return this.database
      .select({ id: databaseClusters.id, name: databaseClusters.name })
      .from(databaseClusters)
      .where(eq(databaseClusters.isActive, true))
      .orderBy(databaseClusters.name)
  }

  async findCluster(id: string) {
    const [cluster] = await this.database
      .select()
      .from(databaseClusters)
      .where(eq(databaseClusters.id, id))
      .limit(1)
    return cluster ?? null
  }

  async createCluster(input: CreateDatabaseClusterInput) {
    const { password, ...metadata } = input
    const [created] = await this.database
      .insert(databaseClusters)
      .values({
        ...metadata,
        credentialEncrypted: encryptInfrastructureCredential(password),
      })
      .returning({ id: databaseClusters.id, name: databaseClusters.name })
    if (!created) throw new Error('Failed to create database cluster.')
    return created
  }

  async updateCluster(id: string, input: UpdateDatabaseClusterInput) {
    const { password, ...metadata } = input
    const values: Partial<typeof databaseClusters.$inferInsert> = {
      ...metadata,
      updatedAt: new Date(),
    }
    if (password) values.credentialEncrypted = encryptInfrastructureCredential(password)
    const [updated] = await this.database
      .update(databaseClusters)
      .set(values)
      .where(eq(databaseClusters.id, id))
      .returning({ id: databaseClusters.id, name: databaseClusters.name })
    return updated ?? null
  }

  async findServiceDatabase(serviceId: string) {
    const [row] = await this.database
      .select()
      .from(serviceDatabases)
      .where(and(eq(serviceDatabases.serviceId, serviceId), isNull(serviceDatabases.deletedAt)))
      .limit(1)
    return row ?? null
  }

  async findServiceDatabaseById(id: string) {
    const [row] = await this.database
      .select({ allocation: serviceDatabases, cluster: databaseClusters })
      .from(serviceDatabases)
      .innerJoin(databaseClusters, eq(databaseClusters.id, serviceDatabases.databaseClusterId))
      .where(eq(serviceDatabases.id, id))
      .limit(1)
    return row ?? null
  }

  async createServiceDatabase(input: typeof serviceDatabases.$inferInsert) {
    const [created] = await this.database.insert(serviceDatabases).values(input).returning()
    if (!created) throw new Error('Failed to create service database allocation.')
    return created
  }

  async markServiceDatabase(id: string, values: Partial<typeof serviceDatabases.$inferInsert>) {
    await this.database
      .update(serviceDatabases)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(serviceDatabases.id, id))
  }

  serializeServiceDatabase(
    row: typeof serviceDatabases.$inferSelect,
    clusterName: string,
  ): ApiServiceDatabase {
    return {
      id: row.id,
      serviceId: row.serviceId,
      databaseClusterId: row.databaseClusterId,
      clusterName,
      databaseName: row.databaseName,
      roleName: row.roleName,
      status: row.status,
      lastError: row.lastError,
      sqlImportedAt: row.sqlImportedAt?.toISOString() ?? null,
      retentionUntil: row.retentionUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
