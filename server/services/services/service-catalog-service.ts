import { and, eq, isNull, sql } from 'drizzle-orm'
import type {
  CreateServiceInput,
  TransitionServiceInput,
  UpdateServiceInput,
} from '../../../shared/schemas/services'
import { useDatabase, type Database } from '../../database/client'
import {
  invoiceItems,
  infrastructureServiceDatabases,
  serviceBillingRuns,
  serviceResources,
  services,
} from '../../database/schema'
import { AuditLogRepository } from '../../repositories/audit'
import {
  allocateDocumentNumber,
  ensureDocumentSequenceFloor,
} from '../../repositories/document-sequences'
import { ServiceRepository } from '../../repositories/services'
import { PlanRepository } from '../../repositories/plans'
import { formatDocumentNumber } from '../../utils/document-number'
import { DomainError } from '../../utils/errors'
import { InfrastructureLifecycleService } from '../infrastructure/lifecycle-service'

interface ActorContext {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export class ServiceCatalogService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly repository = new ServiceRepository(database),
    private readonly audit = new AuditLogRepository(database),
    private readonly plans = new PlanRepository(database),
    private readonly infrastructureLifecycle = new InfrastructureLifecycleService(),
  ) {}

  list(page: number, perPage: number) {
    return this.repository.list(page, perPage)
  }

  options() {
    return this.repository.listCreateOptions()
  }

  async create(input: CreateServiceInput, actor: ActorContext) {
    return this.database.transaction(async (transaction) => {
      const customer = await this.repository.findActiveCustomer(transaction, input.customerId)
      if (!customer) throw DomainError.validation('Customer aktif tidak ditemukan.')

      const plan = await this.plans.findActiveById(transaction, input.planId)
      if (!plan) throw DomainError.validation('Plan aktif tidak ditemukan.')

      // Serialize assignments for each selected resource. This closes the race
      // between availability validation and inserting the service-resource rows.
      for (const resourceId of [...input.resourceIds].sort()) {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${resourceId}))`)
      }

      const eligibleIds = await this.repository.findEligibleResourceIds(
        transaction,
        input.resourceIds,
      )
      if (eligibleIds.length !== input.resourceIds.length) {
        throw DomainError.validation('Satu atau lebih resource tidak valid atau bukan billable.')
      }

      const assignedIds = await this.repository.findAssignedResourceIds(
        transaction,
        input.resourceIds,
      )
      if (assignedIds.length > 0) {
        throw DomainError.conflict('Satu atau lebih resource sudah digunakan oleh service lain.')
      }

      const currentNumberFloor = await this.repository.currentNumberFloor(transaction)
      await ensureDocumentSequenceFloor(transaction, 'service', 'global', currentNumberFloor)
      const sequence = await allocateDocumentNumber(transaction, 'service', 'global')
      const serviceNumber = formatDocumentNumber('SVC', sequence)
      // A new service has not been invoiced yet, so its first billing date is
      // the billing start date. The invoice generator advances this after a
      // successful invoice is issued.
      const nextDueDate = input.nextDueDate ?? input.billingStartDate
      const created = await this.repository.create(
        transaction,
        input,
        plan,
        serviceNumber,
        nextDueDate,
        actor.userId,
      )

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'service.created',
        entityType: 'service',
        entityId: created.id,
        afterData: {
          serviceNumber: created.serviceNumber,
          customerId: created.customerId,
          name: created.name,
          planId: plan.id,
          planName: plan.name,
          priceAmount: plan.priceAmount.toString(),
          currency: plan.currency,
          billingCycle: plan.billingCycle,
          resourceIds: input.resourceIds,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return {
        id: created.id,
        serviceNumber: created.serviceNumber,
        name: created.name,
      }
    })
  }

  async update(id: string, input: UpdateServiceInput, actor: ActorContext) {
    return this.database.transaction(async (transaction) => {
      const existing = await this.repository.findById(transaction, id)
      if (!existing) throw DomainError.notFound('Service tidak ditemukan.')
      if (existing.status === 'cancelled') {
        throw DomainError.invalidState('Service yang sudah dibatalkan tidak dapat diubah.')
      }

      const plan = input.planId ? await this.plans.findActiveById(transaction, input.planId) : null
      if (input.planId && !plan) throw DomainError.validation('Plan aktif tidak ditemukan.')

      if (input.resourceIds !== undefined) {
        for (const resourceId of [...input.resourceIds].sort()) {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${resourceId}))`)
        }
        const eligibleIds = await this.repository.findEligibleResourceIds(
          transaction,
          input.resourceIds,
        )
        if (eligibleIds.length !== input.resourceIds.length) {
          throw DomainError.validation('Satu atau lebih resource tidak valid atau bukan billable.')
        }
        const assignedIds = await this.repository.findAssignedResourceIds(
          transaction,
          input.resourceIds,
          id,
        )
        if (assignedIds.length > 0) {
          throw DomainError.conflict('Satu atau lebih resource sudah digunakan service lain.')
        }
      }

      const updated = await this.repository.update(transaction, id, input, plan)
      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'service.updated',
        entityType: 'service',
        entityId: id,
        beforeData: existing,
        afterData: updated,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return updated
    })
  }

  async transition(id: string, input: TransitionServiceInput, actor: ActorContext) {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(services)
        .where(eq(services.id, id))
        .for('update')
      if (!current) throw DomainError.notFound('Service tidak ditemukan.')
      if (current.status !== input.status) validateTransition(current.status, input.status)
      const updated = await this.repository.transition(transaction, id, input.status, input.reason)
      const operation = await this.infrastructureLifecycle.apply(
        transaction,
        id,
        input.status === 'active' && !current.billingBlocked ? 'active' : 'suspended',
        actor.userId,
      )
      if (input.status === 'cancelled') {
        await transaction
          .update(infrastructureServiceDatabases)
          .set({ status: 'pending_deletion', updatedAt: new Date() })
          .where(eq(infrastructureServiceDatabases.serviceId, id))
      }
      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: `service.${input.status}.requested`,
        entityType: 'service',
        entityId: id,
        beforeData: { status: current.status },
        afterData: { status: updated.status, reason: input.reason },
        metadata: {
          controlledResourceCount: operation.affectedCount,
          infrastructureStatus: operation.affectedCount ? 'pending' : 'ready',
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })
      return {
        ...updated,
        infrastructureStatus: operation.affectedCount ? ('pending' as const) : ('ready' as const),
      }
    })
  }

  /** Permanently removes a cancelled service that has no invoice history. */
  async removeCancelled(id: string, actor: ActorContext) {
    return this.database.transaction(async (transaction) => {
      const existing = await this.repository.findById(transaction, id)
      if (!existing) throw DomainError.notFound('Service tidak ditemukan.')
      if (existing.status !== 'cancelled') {
        throw DomainError.invalidState('Hanya service yang sudah dibatalkan yang dapat dihapus.')
      }

      const [billingRun] = await transaction
        .select({ id: serviceBillingRuns.id })
        .from(serviceBillingRuns)
        .where(eq(serviceBillingRuns.serviceId, id))
        .limit(1)
      if (billingRun) {
        throw DomainError.invalidState('Service yang sudah memiliki invoice tidak dapat dihapus.')
      }

      const [invoiceItem] = await transaction
        .select({ id: invoiceItems.id })
        .from(invoiceItems)
        .where(eq(invoiceItems.serviceId, id))
        .limit(1)
      if (invoiceItem) {
        throw DomainError.invalidState('Service yang sudah memiliki invoice tidak dapat dihapus.')
      }

      const [nativeDatabase] = await transaction
        .select({ id: infrastructureServiceDatabases.id })
        .from(infrastructureServiceDatabases)
        .where(
          and(
            eq(infrastructureServiceDatabases.serviceId, id),
            isNull(infrastructureServiceDatabases.deletedAt),
          ),
        )
        .limit(1)
      if (nativeDatabase) {
        throw DomainError.invalidState(
          'Service masih memiliki database native. Retire database terlebih dahulu.',
        )
      }

      await transaction.delete(serviceResources).where(eq(serviceResources.serviceId, id))
      await transaction.delete(services).where(eq(services.id, id))

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'service.deleted',
        entityType: 'service',
        entityId: id,
        beforeData: {
          serviceNumber: existing.serviceNumber,
          name: existing.name,
          status: existing.status,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return { id: existing.id, serviceNumber: existing.serviceNumber }
    })
  }
}

function validateTransition(currentStatus: string, targetStatus: TransitionServiceInput['status']) {
  if (currentStatus === targetStatus) {
    throw DomainError.invalidState(`Service sudah berstatus ${targetStatus}.`)
  }
  if (currentStatus === 'cancelled') {
    throw DomainError.invalidState('Service yang dibatalkan tidak dapat diaktifkan kembali.')
  }
  if (targetStatus === 'suspended' && currentStatus !== 'active') {
    throw DomainError.invalidState('Hanya service aktif yang dapat disuspend.')
  }
  if (targetStatus === 'active' && currentStatus !== 'suspended') {
    throw DomainError.invalidState('Hanya service suspended yang dapat diaktifkan kembali.')
  }
}
