import { randomUUID } from 'node:crypto'
import type {
  ContainerExecInput,
  CreateApplicationResourceInput,
  OperationLogAppendInput,
  OperationStatusUpdateInput,
  UpdateApplicationResourceInput,
} from '../../../shared/schemas/infrastructure'
import { NativeInfrastructureRepository } from '../../repositories/native-infrastructure'
import { DomainError } from '../../utils/errors'
import { canTransitionOperation, retryDelayMilliseconds } from './operation-state'
import { validateApplicationPolicy } from './policy'
import { ApplicationBuildService } from './application-build-service'

export class NativeInfrastructureService {
  constructor(private readonly repository = new NativeInfrastructureRepository()) {}

  listResources() {
    return this.repository.listResources()
  }

  listOperations(limit?: number) {
    return this.repository.listOperations(limit)
  }

  async createApplication(
    input: CreateApplicationResourceInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    if (input.spec.source.type !== 'image') {
      throw DomainError.invalidState('Build source belum diaktifkan; gunakan image registry.')
    }
    const policy = validateApplicationPolicy(input.spec)
    if (!policy.allowed) {
      throw DomainError.validation('Application spec melanggar policy node.', policy.violations)
    }

    const resourceId = randomUUID()
    let result
    try {
      result = await this.repository.createApplication({
        resourceId,
        externalId: `pending:${resourceId}`,
        idempotencyKey,
        actorUserId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        input,
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw error
      return { operation, replayed: true }
    }
    if (!result) throw DomainError.invalidState('Node tidak aktif, offline, atau sedang drain.')
    return result
  }

  async createLifecycleOperation(
    resourceId: string,
    action:
      | 'application.start'
      | 'application.stop'
      | 'application.restart'
      | 'application.redeploy'
      | 'application.delete',
    actorUserId: string,
    idempotencyKey: string,
  ) {
    let result
    try {
      result = await this.repository.createLifecycleOperation({
        resourceId,
        action,
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw error
      return { operation, replayed: true }
    }
    if (!result) throw DomainError.notFound('Resource tidak ditemukan.')
    return result
  }

  async createContainerExecOperation(
    resourceId: string,
    input: ContainerExecInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    let result
    try {
      result = await this.repository.createContainerExecOperation({
        resourceId,
        command: input.command,
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 60_000),
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw error
      return { operation, replayed: true }
    }

    if ('reason' in result) {
      if (result.reason === 'not_found') throw DomainError.notFound('Application tidak ditemukan.')
      if (result.reason === 'not_running') {
        throw DomainError.invalidState(
          'Docker sh hanya tersedia untuk container yang sedang running dan sinkron.',
        )
      }
      if (result.reason === 'node_unavailable') {
        throw DomainError.invalidState('Node sedang offline, drain, atau tidak aktif.')
      }
      throw DomainError.invalidState(
        'Docker sh membutuhkan OC Agent yang mendukung container-exec.',
      )
    }
    return result
  }

  async containerExecOperation(resourceId: string, operationId: string) {
    const operation = await this.repository.findContainerExecOperation(resourceId, operationId)
    if (!operation) throw DomainError.notFound('Docker sh operation tidak ditemukan.')
    return operation
  }

  async updateApplication(
    resourceId: string,
    input: UpdateApplicationResourceInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    if (input.spec.source.type !== 'image') {
      throw DomainError.invalidState('Build source belum diaktifkan; gunakan image registry.')
    }
    const policy = validateApplicationPolicy(input.spec)
    if (!policy.allowed) {
      throw DomainError.validation('Application spec melanggar policy node.', policy.violations)
    }

    let result
    try {
      result = await this.repository.updateApplication({
        resourceId,
        input,
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw error
      return { operation, replayed: true }
    }
    if (!result) throw DomainError.notFound('Application tidak ditemukan.')
    return result
  }

  async claimNextOperation(nodeId: string, workerId: string) {
    await this.failExpiredExecutingOperations(nodeId)
    return this.repository.claimNextOperation(nodeId, workerId)
  }

  async failExpiredExecutingOperations(nodeId: string) {
    const expired = await this.repository.listExpiredExecutingOperationIds(nodeId)
    for (const candidate of expired) {
      const operation = await this.repository.findOperationForNode(nodeId, candidate.id)
      if (
        !operation ||
        !['dispatched', 'running'].includes(operation.status) ||
        operation.expiresAt.getTime() > Date.now()
      ) {
        continue
      }
      await this.repository.recordOperationStatus(nodeId, operation.id, {
        status: 'failed',
        retryable: false,
        errorCode: 'operation_timeout',
        errorMessage: 'Operation melewati batas waktu eksekusi dan dihentikan oleh watchdog.',
      })
    }
  }

  async listCancelledExecutingOperationIds(nodeId: string) {
    const operations = await this.repository.listCancelledExecutingOperationIds(nodeId)
    return operations.map((operation) => operation.id)
  }

  async forceStopOperation(operationId: string, actorUserId: string) {
    const result = await this.repository.forceStopOperation(operationId, actorUserId)
    if ('reason' in result) {
      if (result.reason === 'not_found') throw DomainError.notFound('Operation tidak ditemukan.')
      throw DomainError.invalidState(
        `Operation berstatus ${result.operation.status} dan tidak dapat dihentikan.`,
      )
    }
    return result
  }

  async recordOperationStatus(
    nodeId: string,
    operationId: string,
    input: OperationStatusUpdateInput,
  ) {
    const operation = await this.repository.findOperationForNode(nodeId, operationId)
    if (!operation) throw DomainError.notFound('Operation tidak ditemukan.')
    const targetStatus = input.status
    if (operation.status === targetStatus) {
      if (operation.action === 'application.build') {
        await new ApplicationBuildService().synchronizeOperation(
          operation.id,
          input,
          operation.status,
        )
      }
      return operation
    }
    if (!canTransitionOperation(operation.status, targetStatus)) {
      throw DomainError.invalidState(
        `Transition operation ${operation.status} -> ${targetStatus} ditolak.`,
      )
    }
    const nextAttemptAt = input.retryable
      ? new Date(Date.now() + retryDelayMilliseconds(operation.attemptCount))
      : undefined
    const updated = await this.repository.recordOperationStatus(
      nodeId,
      operationId,
      input,
      nextAttemptAt,
    )
    if (!updated) throw DomainError.notFound('Operation tidak ditemukan.')
    if (operation.action === 'application.build') {
      await new ApplicationBuildService().synchronizeOperation(operation.id, input, updated.status)
    }
    return updated
  }

  async appendOperationLogs(
    nodeId: string,
    operationId: string,
    input: OperationLogAppendInput,
  ) {
    const operation = await this.repository.appendOperationLogs(nodeId, operationId, input)
    if (!operation) throw DomainError.notFound('Operation tidak ditemukan.')
    return {
      id: operation.id,
      logUpdatedAt: operation.logUpdatedAt?.toISOString() ?? null,
    }
  }
}

export function requireIdempotencyKey(value: string | undefined) {
  const key = value?.trim()
  if (!key || key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw DomainError.validation('Header Idempotency-Key tidak valid.')
  }
  return key
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
