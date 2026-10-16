import { randomBytes, randomUUID } from 'node:crypto'
import type { CreateNativeDatabaseClusterInput } from '../../../shared/schemas/native-database-clusters'
import type { ProvisionNativeServiceDatabaseInput } from '../../../shared/schemas/native-service-databases'
import { NativeDatabaseClusterRepository } from '../../repositories/native-database-clusters'
import {
  decryptInfrastructureCredential,
  encryptInfrastructureCredential,
} from '../../utils/credentials'
import { DomainError } from '../../utils/errors'

export class NativeDatabaseClusterService {
  constructor(private readonly repository = new NativeDatabaseClusterRepository()) {}

  overview() {
    return this.repository.overview()
  }

  async activate(
    input: CreateNativeDatabaseClusterInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    try {
      const result = await this.repository.activate({
        clusterId: randomUUID(),
        operationId: randomUUID(),
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        input,
      })
      if (!result) {
        throw DomainError.validation(
          'Resource bukan PostgreSQL native yang eligible atau node tidak tersedia.',
        )
      }
      if ('conflict' in result) {
        throw DomainError.conflict('Resource PostgreSQL sudah menjadi primary cluster.')
      }
      if ('unavailable' in result) {
        throw DomainError.invalidState('PostgreSQL harus berstatus running sebelum diaktifkan.')
      }
      if ('incompatibleAgent' in result) {
        throw DomainError.invalidState(
          'Aktivasi cluster membutuhkan OC Agent 0.4.0 atau lebih baru.',
        )
      }
      return result
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw DomainError.conflict('Nama cluster sudah digunakan.')
      return { operation, replayed: true }
    }
  }

  async provisionServiceDatabase(
    clusterId: string,
    input: ProvisionNativeServiceDatabaseInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    const clusterTarget = await this.repository.findClusterConnectionTarget(clusterId)
    if (!clusterTarget) throw DomainError.notFound('Database cluster tidak ditemukan.')
    const allocationId = randomUUID()
    const identifier = allocationId.replaceAll('-', '').slice(0, 24)
    const databaseName = `oc_${identifier}`
    const roleName = `${databaseName}_app`
    const password = randomBytes(32).toString('base64url')
    const networkAlias = `oc-${clusterTarget.primaryResourceId.replaceAll('-', '')}`
    const connectionUri = `postgresql://${encodeURIComponent(roleName)}:${encodeURIComponent(password)}@${networkAlias}:5432/${databaseName}?sslmode=disable`

    try {
      const result = await this.repository.provisionServiceDatabase({
        clusterId,
        allocationId,
        operationId: randomUUID(),
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        databaseName,
        roleName,
        passwordEncrypted: encryptInfrastructureCredential(password),
        connectionUriEncrypted: encryptInfrastructureCredential(connectionUri),
        networkAlias,
        input,
      })
      if (!result) throw DomainError.notFound('Database cluster tidak ditemukan.')
      if ('unavailable' in result) {
        throw DomainError.invalidState('Cluster, PostgreSQL, atau node sedang tidak tersedia.')
      }
      if ('incompatibleAgent' in result) {
        throw DomainError.invalidState(
          'Provisioning database membutuhkan OC Agent 0.5.0 atau lebih baru.',
        )
      }
      if ('invalidService' in result) {
        throw DomainError.validation('Service tidak ditemukan atau sudah dibatalkan.')
      }
      if ('invalidApplication' in result) {
        throw DomainError.validation('Application resource native tidak ditemukan.')
      }
      if ('differentNode' in result) {
        throw DomainError.validation(
          'MVP mengharuskan aplikasi dan PostgreSQL berada pada node yang sama.',
        )
      }
      if ('customerMismatch' in result) {
        throw DomainError.validation('Customer aplikasi berbeda dengan customer service.')
      }
      if ('conflict' in result) {
        throw DomainError.conflict('Service atau aplikasi sudah memiliki database aktif.')
      }
      return result
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw DomainError.conflict('Service atau aplikasi sudah memiliki database.')
      return { operation, replayed: true }
    }
  }

  async revealServiceDatabase(allocationId: string, actorUserId: string) {
    const allocation = await this.repository.revealServiceDatabase(allocationId, actorUserId)
    if (!allocation) throw DomainError.notFound('Alokasi database tidak ditemukan.')
    if (allocation.status !== 'active') {
      throw DomainError.invalidState('Credential hanya dapat dilihat setelah database aktif.')
    }
    return {
      id: allocation.id,
      serviceId: allocation.serviceId,
      clusterName: allocation.clusterName,
      applicationName: allocation.applicationName,
      databaseName: allocation.databaseName,
      roleName: allocation.roleName,
      environmentKey: allocation.environmentKey,
      password: decryptInfrastructureCredential(allocation.passwordEncrypted),
      connectionUri: decryptInfrastructureCredential(allocation.connectionUriEncrypted),
    }
  }

  async retryServiceDatabase(allocationId: string, actorUserId: string, idempotencyKey: string) {
    return this.reprovisionServiceDatabase(allocationId, actorUserId, idempotencyKey, 'retry')
  }

  async rotateServiceDatabase(allocationId: string, actorUserId: string, idempotencyKey: string) {
    return this.reprovisionServiceDatabase(allocationId, actorUserId, idempotencyKey, 'rotate')
  }

  async createBackup(
    allocationId: string,
    actorUserId: string,
    idempotencyKey: string,
    destination?: {
      policyId: string
      storageTargetId: string
      endpoint: string
      region: string
      bucket: string
      prefix: string
      pathStyle: boolean
    },
  ) {
    const backupId = randomUUID()
    const objectKey = destination
      ? `${destination.prefix.replace(/\/+$/, '')}/postgresql/${allocationId}/${backupId}.dump`
      : undefined
    const result = await this.repository.createBackup({
      backupId,
      allocationId,
      operationId: randomUUID(),
      actorUserId,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      policyId: destination?.policyId,
      storageTargetId: destination?.storageTargetId,
      objectKey,
      objectStorage: destination && objectKey
        ? {
            provider: 's3',
            endpoint: destination.endpoint,
            region: destination.region,
            bucket: destination.bucket,
            objectKey,
            pathStyle: destination.pathStyle,
          }
        : undefined,
    })
    if (!result) throw DomainError.notFound('Alokasi database tidak ditemukan.')
    if ('unavailable' in result) {
      throw DomainError.invalidState('Database, cluster, atau node belum siap untuk backup.')
    }
    if ('incompatibleAgent' in result) {
      throw DomainError.invalidState('Backup workload membutuhkan OC Agent 0.10.0 atau lebih baru.')
    }
    return result
  }

  async restoreBackup(backupId: string, actorUserId: string, idempotencyKey: string) {
    const result = await this.repository.restoreBackup({
      backupId,
      operationId: randomUUID(),
      actorUserId,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })
    if (!result) throw DomainError.notFound('Backup database tidak ditemukan.')
    if ('unavailable' in result) {
      throw DomainError.invalidState('Backup, database, cluster, atau node belum siap direstore.')
    }
    if ('incompatibleAgent' in result) {
      throw DomainError.invalidState('Restore workload membutuhkan OC Agent 0.10.0 atau lebih baru.')
    }
    return result
  }

  private async reprovisionServiceDatabase(
    allocationId: string,
    actorUserId: string,
    idempotencyKey: string,
    mode: 'retry' | 'rotate',
  ) {
    const context = await this.repository.findServiceDatabaseContext(allocationId)
    if (!context) throw DomainError.notFound('Alokasi database tidak ditemukan.')

    let passwordEncrypted: string | undefined
    let connectionUriEncrypted: string | undefined
    if (mode === 'rotate') {
      const password = randomBytes(32).toString('base64url')
      const host = `oc-${context.primaryResourceId.replaceAll('-', '')}`
      const connectionUri = `postgresql://${encodeURIComponent(context.roleName)}:${encodeURIComponent(password)}@${host}:5432/${context.databaseName}?sslmode=disable`
      passwordEncrypted = encryptInfrastructureCredential(password)
      connectionUriEncrypted = encryptInfrastructureCredential(connectionUri)
    }

    try {
      const result = await this.repository.reprovisionServiceDatabase({
        allocationId,
        operationId: randomUUID(),
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        mode,
        passwordEncrypted,
        connectionUriEncrypted,
      })
      if (!result) throw DomainError.notFound('Alokasi database tidak ditemukan.')
      if ('invalidState' in result) {
        throw DomainError.invalidState(
          mode === 'rotate'
            ? 'Credential hanya dapat dirotasi ketika database aktif.'
            : 'Retry hanya dapat dijalankan ketika provisioning gagal.',
        )
      }
      if ('unavailable' in result) {
        throw DomainError.invalidState('Cluster, PostgreSQL, atau node sedang tidak tersedia.')
      }
      if ('incompatibleAgent' in result) {
        throw DomainError.invalidState('Operasi membutuhkan OC Agent 0.5.0 atau lebih baru.')
      }
      return result
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw DomainError.conflict('Operasi database sedang berjalan.')
      return { operation, replayed: true }
    }
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
