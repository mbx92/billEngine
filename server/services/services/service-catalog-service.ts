import { sql } from 'drizzle-orm'
import type { CreateServiceInput } from '../../../shared/schemas/services'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository } from '../../repositories/audit'
import {
  allocateDocumentNumber,
  ensureDocumentSequenceFloor,
} from '../../repositories/document-sequences'
import { ServiceRepository } from '../../repositories/services'
import { PlanRepository } from '../../repositories/plans'
import { formatDocumentNumber } from '../../utils/document-number'
import { DomainError } from '../../utils/errors'

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
}
