import { and, asc, count, eq, exists, inArray, isNull, ne, notExists, sql } from 'drizzle-orm'
import type { CreateServiceInput, UpdateServiceInput } from '../../shared/schemas/services'
import type { ApiService, ApiServiceOptions, ApiServiceResourceLink } from '../../shared/types/api'
import { useDatabase, type Database, type Transaction } from '../database/client'
import {
  customers,
  infrastructureDatabaseClusters,
  infrastructureNodes,
  infrastructureResources,
  infrastructureServiceDatabases,
  serviceBillingRuns,
  serviceResources,
  services,
} from '../database/schema'
import { PlanRepository, type PlanRecord } from './plans'
import { evaluateInfrastructureAllocation } from '../services/infrastructure/allocation'

type QueryExecutor = Database | Transaction

export class ServiceRepository {
  private readonly plans: PlanRepository

  constructor(private readonly database: Database = useDatabase()) {
    this.plans = new PlanRepository(database)
  }

  async list(page: number, perPage: number) {
    const offset = (page - 1) * perPage
    const billingRun = this.database
      .select({ id: serviceBillingRuns.id })
      .from(serviceBillingRuns)
      .where(eq(serviceBillingRuns.serviceId, services.id))

    const [rows, totals] = await Promise.all([
      this.database
        .select({
          id: services.id,
          serviceNumber: services.serviceNumber,
          name: services.name,
          planId: services.planId,
          planName: services.planName,
          planInclusions: services.planInclusions,
          planResourceCount: services.planResourceCount,
          planCpuCores: services.planCpuCores,
          planMemoryBytes: services.planMemoryBytes,
          planDatabaseMode: services.planDatabaseMode,
          status: services.status,
          currency: services.currency,
          priceAmount: services.priceAmount,
          billingCycle: services.billingCycle,
          billingStartDate: services.billingStartDate,
          nextDueDate: services.nextDueDate,
          invoiceLeadDays: services.invoiceLeadDays,
          paymentDueDays: services.paymentDueDays,
          taxRate: services.taxRate,
          description: services.description,
          suspendedAt: services.suspendedAt,
          suspensionReason: services.suspensionReason,
          cancelledAt: services.cancelledAt,
          cancellationReason: services.cancellationReason,
          hasBillingRun: exists(billingRun),
          customerId: services.customerId,
          customerName: customers.name,
          customerNumber: customers.customerNumber,
        })
        .from(services)
        .innerJoin(customers, eq(customers.id, services.customerId))
        .orderBy(asc(services.nextDueDate), asc(services.serviceNumber))
        .limit(perPage)
        .offset(offset),
      this.database.select({ total: count() }).from(services),
    ])

    const [linkedResources, linkedDatabases] = await Promise.all([
      this.findResourceLinks(rows.map((row) => row.id)),
      this.findDatabaseLinks(rows.map((row) => row.id)),
    ])

    return {
      rows: rows.map<ApiService>((row) => {
        const resources = linkedResources.get(row.id) ?? []
        return {
          id: row.id,
          serviceNumber: row.serviceNumber,
          name: row.name,
          planId: row.planId,
          planName: row.planName,
          planInclusions: row.planInclusions,
          planResourceCount: row.planResourceCount,
          planCpuCores: row.planCpuCores,
          planMemoryBytes: row.planMemoryBytes?.toString() ?? null,
          planDatabaseMode: row.planDatabaseMode,
          status: row.status,
          currency: row.currency,
          priceAmount: row.priceAmount.toString(),
          billingCycle: row.billingCycle,
          billingStartDate: row.billingStartDate,
          nextDueDate: row.hasBillingRun ? row.nextDueDate : row.billingStartDate,
          invoiceLeadDays: row.invoiceLeadDays,
          paymentDueDays: row.paymentDueDays,
          taxRate: row.taxRate,
          description: row.description,
          suspendedAt: row.suspendedAt?.toISOString() ?? null,
          suspensionReason: row.suspensionReason,
          cancelledAt: row.cancelledAt?.toISOString() ?? null,
          cancellationReason: row.cancellationReason,
          customerId: row.customerId,
          customerName: row.customerName,
          customerNumber: row.customerNumber,
          resources,
          database: linkedDatabases.get(row.id) ?? null,
          infrastructure: evaluateInfrastructureAllocation(
            {
              resourceCount: row.planResourceCount,
              cpuCores: row.planCpuCores,
              memoryBytes: row.planMemoryBytes,
            },
            resources,
          ),
        }
      }),
      total: totals[0]?.total ?? 0,
    }
  }

  async listByCustomer(customerId: string) {
    const billingRun = this.database
      .select({ id: serviceBillingRuns.id })
      .from(serviceBillingRuns)
      .where(eq(serviceBillingRuns.serviceId, services.id))
    const rows = await this.database
      .select({
        id: services.id,
        serviceNumber: services.serviceNumber,
        name: services.name,
        planId: services.planId,
        planName: services.planName,
        planInclusions: services.planInclusions,
        planResourceCount: services.planResourceCount,
        planCpuCores: services.planCpuCores,
        planMemoryBytes: services.planMemoryBytes,
        planDatabaseMode: services.planDatabaseMode,
        status: services.status,
        currency: services.currency,
        priceAmount: services.priceAmount,
        billingCycle: services.billingCycle,
        billingStartDate: services.billingStartDate,
        nextDueDate: services.nextDueDate,
        hasBillingRun: exists(billingRun),
        invoiceLeadDays: services.invoiceLeadDays,
        paymentDueDays: services.paymentDueDays,
        taxRate: services.taxRate,
        description: services.description,
        suspendedAt: services.suspendedAt,
        suspensionReason: services.suspensionReason,
        cancelledAt: services.cancelledAt,
        cancellationReason: services.cancellationReason,
        customerId: services.customerId,
        customerName: customers.name,
        customerNumber: customers.customerNumber,
      })
      .from(services)
      .innerJoin(customers, eq(customers.id, services.customerId))
      .where(eq(services.customerId, customerId))
      .orderBy(asc(services.serviceNumber))

    const [linkedResources, linkedDatabases] = await Promise.all([
      this.findResourceLinks(rows.map((row) => row.id)),
      this.findDatabaseLinks(rows.map((row) => row.id)),
    ])
    return rows.map<ApiService>((row) => {
      const resources = linkedResources.get(row.id) ?? []
      return {
        id: row.id,
        serviceNumber: row.serviceNumber,
        name: row.name,
        planId: row.planId,
        planName: row.planName,
        planInclusions: row.planInclusions,
        planResourceCount: row.planResourceCount,
        planCpuCores: row.planCpuCores,
        planMemoryBytes: row.planMemoryBytes?.toString() ?? null,
        planDatabaseMode: row.planDatabaseMode,
        status: row.status,
        currency: row.currency,
        priceAmount: row.priceAmount.toString(),
        billingCycle: row.billingCycle,
        billingStartDate: row.billingStartDate,
        nextDueDate: row.hasBillingRun ? row.nextDueDate : row.billingStartDate,
        invoiceLeadDays: row.invoiceLeadDays,
        paymentDueDays: row.paymentDueDays,
        taxRate: row.taxRate,
        description: row.description,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
        suspensionReason: row.suspensionReason,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        cancellationReason: row.cancellationReason,
        customerId: row.customerId,
        customerName: row.customerName,
        customerNumber: row.customerNumber,
        resources,
        database: linkedDatabases.get(row.id) ?? null,
        infrastructure: evaluateInfrastructureAllocation(
          {
            resourceCount: row.planResourceCount,
            cpuCores: row.planCpuCores,
            memoryBytes: row.planMemoryBytes,
          },
          resources,
        ),
      }
    })
  }

  async listCreateOptions(): Promise<ApiServiceOptions> {
    const [planRows, customerRows, resourceRows] = await Promise.all([
      this.plans.listActiveOptions(),
      this.database
        .select({
          id: customers.id,
          customerNumber: customers.customerNumber,
          name: customers.name,
          companyName: customers.companyName,
          email: customers.email,
        })
        .from(customers)
        .where(eq(customers.status, 'active'))
        .orderBy(asc(customers.name)),
      this.database
        .select({
          id: infrastructureResources.id,
          name: infrastructureResources.name,
          status: infrastructureResources.observedState,
          serverName: infrastructureNodes.name,
          environmentName: infrastructureNodes.environment,
          desiredSpec: infrastructureResources.desiredSpec,
        })
        .from(infrastructureResources)
        .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
        .where(
          and(
            eq(infrastructureResources.classification, 'billable'),
            isNull(infrastructureResources.deletedAt),
            notExists(
              this.database
                .select({ id: serviceResources.id })
                .from(serviceResources)
                .innerJoin(services, eq(services.id, serviceResources.serviceId))
                .where(
                  and(
                    eq(serviceResources.resourceId, infrastructureResources.id),
                    ne(services.status, 'cancelled'),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(infrastructureNodes.name), asc(infrastructureResources.name)),
    ])

    return {
      plans: planRows,
      customers: customerRows,
      resources: resourceRows.map((resource) => ({
        id: resource.id,
        name: resource.name,
        status: resource.status,
        serverName: resource.serverName,
        projectName: null,
        environmentName: resource.environmentName,
        ...resourceLimits(resource.desiredSpec),
      })),
    }
  }

  async findActiveCustomer(transaction: QueryExecutor, id: string) {
    const [customer] = await transaction
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.status, 'active')))
      .limit(1)
    return customer ?? null
  }

  async findById(transaction: QueryExecutor, id: string) {
    const [service] = await transaction.select().from(services).where(eq(services.id, id)).limit(1)
    return service ?? null
  }

  async currentNumberFloor(transaction: QueryExecutor): Promise<bigint> {
    const [row] = await transaction
      .select({
        value: sql<string>`coalesce(max(substring(${services.serviceNumber} from '([0-9]+)$')::bigint), 0)::text`,
      })
      .from(services)
    return BigInt(row?.value ?? '0')
  }

  async findEligibleResourceIds(transaction: QueryExecutor, ids: string[]) {
    if (ids.length === 0) return []
    const rows = await transaction
      .select({ id: infrastructureResources.id })
      .from(infrastructureResources)
      .where(
        and(
          inArray(infrastructureResources.id, ids),
          eq(infrastructureResources.classification, 'billable'),
          isNull(infrastructureResources.deletedAt),
        ),
      )
    return rows.map((row) => row.id)
  }

  async findActiveCustomerServiceIds(
    transaction: QueryExecutor,
    customerId: string,
    ids: string[],
  ) {
    if (ids.length === 0) return []
    const rows = await transaction
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          inArray(services.id, ids),
          eq(services.customerId, customerId),
          eq(services.status, 'active'),
        ),
      )
    return rows.map((row) => row.id)
  }

  async findAssignedResourceIds(
    transaction: QueryExecutor,
    ids: string[],
    excludeServiceId?: string,
  ) {
    if (ids.length === 0) return []
    const assignmentConditions = [
      inArray(serviceResources.resourceId, ids),
      ne(services.status, 'cancelled'),
    ]
    if (excludeServiceId) assignmentConditions.push(ne(services.id, excludeServiceId))

    const rows = await transaction
      .select({ id: serviceResources.resourceId })
      .from(serviceResources)
      .innerJoin(services, eq(services.id, serviceResources.serviceId))
      .where(and(...assignmentConditions))
    return [...new Set(rows.map((row) => row.id))]
  }

  async create(
    transaction: Transaction,
    input: CreateServiceInput,
    plan: PlanRecord,
    serviceNumber: string,
    nextDueDate: string | null,
    createdBy: string | null,
  ) {
    const [created] = await transaction
      .insert(services)
      .values({
        customerId: input.customerId,
        planId: plan.id,
        planName: plan.name,
        planInclusions: plan.inclusions,
        planResourceCount: plan.includedResourceCount,
        planCpuCores: plan.includedCpuCores,
        planMemoryBytes: plan.includedMemoryBytes,
        planDatabaseMode: plan.databaseMode,
        serviceNumber,
        name: input.name,
        description: input.description,
        currency: plan.currency,
        priceAmount: plan.priceAmount,
        billingCycle: plan.billingCycle,
        billingStartDate: input.billingStartDate,
        nextDueDate,
        invoiceLeadDays: input.invoiceLeadDays,
        paymentDueDays: input.paymentDueDays,
        taxRate: input.taxRate,
      })
      .returning()

    if (!created) throw new Error('Failed to create service.')

    if (input.resourceIds.length > 0) {
      await transaction.insert(serviceResources).values(
        input.resourceIds.map((resourceId) => ({
          serviceId: created.id,
          resourceId,
          createdBy,
        })),
      )
    }

    return created
  }

  async update(
    transaction: Transaction,
    id: string,
    input: UpdateServiceInput,
    plan: PlanRecord | null,
  ) {
    const values: Partial<typeof services.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) values.name = input.name
    if (input.description !== undefined) values.description = input.description
    if (input.nextDueDate !== undefined) values.nextDueDate = input.nextDueDate
    if (input.invoiceLeadDays !== undefined) values.invoiceLeadDays = input.invoiceLeadDays
    if (input.paymentDueDays !== undefined) values.paymentDueDays = input.paymentDueDays
    if (input.taxRate !== undefined) values.taxRate = input.taxRate
    if (plan) {
      values.planId = plan.id
      values.planName = plan.name
      values.planInclusions = plan.inclusions
      values.currency = plan.currency
      values.priceAmount = plan.priceAmount
      values.billingCycle = plan.billingCycle
      values.planResourceCount = plan.includedResourceCount
      values.planCpuCores = plan.includedCpuCores
      values.planMemoryBytes = plan.includedMemoryBytes
      values.planDatabaseMode = plan.databaseMode
    }

    const [updated] = await transaction
      .update(services)
      .set(values)
      .where(eq(services.id, id))
      .returning()
    if (!updated) throw new Error('Failed to update service.')

    if (input.resourceIds !== undefined) {
      await transaction.delete(serviceResources).where(eq(serviceResources.serviceId, id))
      if (input.resourceIds.length > 0) {
        await transaction.insert(serviceResources).values(
          input.resourceIds.map((resourceId) => ({
            serviceId: id,
            resourceId,
          })),
        )
      }
    }

    return updated
  }

  async transition(
    transaction: Transaction,
    id: string,
    status: 'active' | 'suspended' | 'cancelled',
    reason: string,
  ) {
    const now = new Date()
    const [updated] = await transaction
      .update(services)
      .set({
        status,
        suspendedAt: status === 'suspended' ? now : null,
        suspensionReason: status === 'suspended' ? reason : null,
        cancelledAt: status === 'cancelled' ? now : null,
        cancellationReason: status === 'cancelled' ? reason : null,
        updatedAt: now,
      })
      .where(eq(services.id, id))
      .returning()

    if (!updated) throw new Error('Failed to change service status.')
    return updated
  }

  private async findResourceLinks(serviceIds: string[]) {
    const links = new Map<string, ApiServiceResourceLink[]>()
    if (serviceIds.length === 0) return links

    const rows = await this.database
      .select({
        serviceId: serviceResources.serviceId,
        resourceId: infrastructureResources.id,
        name: infrastructureResources.name,
        status: infrastructureResources.observedState,
        desiredSpec: infrastructureResources.desiredSpec,
      })
      .from(serviceResources)
      .innerJoin(
        infrastructureResources,
        eq(infrastructureResources.id, serviceResources.resourceId),
      )
      .where(inArray(serviceResources.serviceId, serviceIds))

    for (const row of rows) {
      const existing = links.get(row.serviceId) ?? []
      existing.push({
        id: row.resourceId,
        name: row.name,
        status: row.status,
        ...resourceLimits(row.desiredSpec),
      })
      links.set(row.serviceId, existing)
    }

    return links
  }

  private async findDatabaseLinks(serviceIds: string[]) {
    const links = new Map<string, ApiService['database']>()
    if (serviceIds.length === 0) return links

    const nativeRows = await this.database
      .select({
        allocation: infrastructureServiceDatabases,
        clusterName: infrastructureDatabaseClusters.name,
      })
      .from(infrastructureServiceDatabases)
      .innerJoin(
        infrastructureDatabaseClusters,
        eq(infrastructureDatabaseClusters.id, infrastructureServiceDatabases.databaseClusterId),
      )
      .where(
        and(
          inArray(infrastructureServiceDatabases.serviceId, serviceIds),
          isNull(infrastructureServiceDatabases.deletedAt),
        ),
      )

    for (const { allocation, clusterName } of nativeRows) {
      if (!allocation.serviceId) continue
      links.set(allocation.serviceId, {
        id: allocation.id,
        serviceId: allocation.serviceId,
        databaseClusterId: allocation.databaseClusterId,
        clusterName,
        databaseName: allocation.databaseName,
        roleName: allocation.roleName,
        status: allocation.status,
        lastError: allocation.lastError,
        sqlImportedAt: null,
        retentionUntil: null,
        createdAt: allocation.createdAt.toISOString(),
        updatedAt: allocation.updatedAt.toISOString(),
      })
    }
    return links
  }
}

function resourceLimits(desiredSpec: Record<string, unknown>) {
  const limits = (desiredSpec as { limits?: { cpuMilli?: number; memoryBytes?: string } }).limits
  return {
    limitsCpus: limits?.cpuMilli === undefined ? null : milliToDecimal(limits.cpuMilli),
    limitsMemoryBytes: limits?.memoryBytes ?? null,
  }
}

function milliToDecimal(value: number) {
  const whole = Math.floor(value / 1000)
  const fraction = String(value % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}
