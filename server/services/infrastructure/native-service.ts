import { randomUUID } from 'node:crypto'
import type {
  CreateApplicationResourceInput,
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

  claimNextOperation(nodeId: string, workerId: string) {
    return this.repository.claimNextOperation(nodeId, workerId)
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
