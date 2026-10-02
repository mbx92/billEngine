import type {
  CreateDatabaseClusterInput,
  UpdateDatabaseClusterInput,
} from '../../../shared/schemas/database-provisioning'
import { SharedDatabaseClient } from '../../integrations/postgres/shared-database-client'
import { DatabaseProvisioningRepository } from '../../repositories/database-provisioning'
import { decryptInfrastructureCredential } from '../../utils/credentials'
import { DomainError } from '../../utils/errors'
import { CoolifyResourceService } from '../coolify/resource-service'

export class DatabaseClusterService {
  constructor(private readonly repository = new DatabaseProvisioningRepository()) {}

  async overview() {
    const [clusters, servers] = await Promise.all([
      this.repository.listClusters(),
      new CoolifyResourceService().listServers(),
    ])
    const inspectedClusters = await Promise.all(
      clusters.map(async (cluster) => {
        if (!cluster.isActive) return cluster
        const stored = await this.repository.findCluster(cluster.id)
        if (!stored) return cluster
        try {
          const inspection = await clientForCluster(stored).inspectConnection()
          return {
            ...cluster,
            totalDatabaseCount: inspection.databaseCount,
            connectionStatus: 'connected' as const,
          }
        } catch {
          return { ...cluster, connectionStatus: 'unreachable' as const }
        }
      }),
    )
    return { clusters: inspectedClusters, servers }
  }

  async create(input: CreateDatabaseClusterInput) {
    await this.testInput(input)
    try {
      return await this.repository.createCluster(input)
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Nama cluster sudah digunakan.')
      throw error
    }
  }

  async update(id: string, input: UpdateDatabaseClusterInput) {
    const current = await this.repository.findCluster(id)
    if (!current) throw DomainError.notFound('Cluster database tidak ditemukan.')
    if (input.isActive === false) {
      const listed = await this.repository.listClusters()
      const cluster = listed.find((item) => item.id === id)
      if (cluster?.activeDatabaseCount) {
        throw DomainError.invalidState(
          'Cluster masih memiliki database service aktif dan tidak dapat dinonaktifkan.',
        )
      }
    }
    if (input.isActive !== false) {
      try {
        await new SharedDatabaseClient({
          host: input.host ?? current.host,
          port: input.port ?? current.port,
          database: input.adminDatabase ?? current.adminDatabase,
          user: input.provisionerUsername ?? current.provisionerUsername,
          password: input.password ?? decryptInfrastructureCredential(current.credentialEncrypted),
          sslMode: (input.sslMode ?? current.sslMode) as 'disable' | 'prefer' | 'require',
        }).testConnection()
      } catch {
        throw DomainError.external('Perubahan tidak disimpan karena test koneksi PostgreSQL gagal.')
      }
    }
    const updated = await this.repository.updateCluster(id, input)
    if (!updated) throw DomainError.notFound('Cluster database tidak ditemukan.')
    return updated
  }

  async test(id: string) {
    const cluster = await this.repository.findCluster(id)
    if (!cluster) throw DomainError.notFound('Cluster database tidak ditemukan.')
    try {
      const inspection = await clientForCluster(cluster).inspectConnection()
      return { connected: true, ...inspection }
    } catch {
      throw DomainError.external(
        'Koneksi PostgreSQL gagal. Periksa host, network, credential, dan mode SSL.',
      )
    }
  }

  private async testInput(input: CreateDatabaseClusterInput) {
    try {
      await new SharedDatabaseClient({
        host: input.host,
        port: input.port,
        database: input.adminDatabase,
        user: input.provisionerUsername,
        password: input.password,
        sslMode: input.sslMode,
      }).testConnection()
    } catch {
      throw DomainError.external(
        'Koneksi PostgreSQL gagal. Cluster belum disimpan; periksa network dan credential.',
      )
    }
  }
}

export function clientForCluster(cluster: {
  host: string
  port: number
  adminDatabase: string
  provisionerUsername: string
  credentialEncrypted: string
  sslMode: string
}) {
  return new SharedDatabaseClient({
    host: cluster.host,
    port: cluster.port,
    database: cluster.adminDatabase,
    user: cluster.provisionerUsername,
    password: decryptInfrastructureCredential(cluster.credentialEncrypted),
    sslMode: cluster.sslMode as 'disable' | 'prefer' | 'require',
  })
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}
