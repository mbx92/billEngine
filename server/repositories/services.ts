import { and, asc, count, eq, exists, inArray, ne, notExists, sql } from 'drizzle-orm'
import type { CreateServiceInput } from '../../shared/schemas/services'
import type { ApiService, ApiServiceOptions, ApiServiceResourceLink } from '../../shared/types/api'
import { useDatabase, type Database, type Transaction } from '../database/client'
import {
  coolifyResources,
  coolifyServers,
  customers,
  serviceBillingRuns,
  serviceResources,
  services,
} from '../database/schema'
import { PlanRepository, type PlanRecord } from './plans'

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
          status: services.status,
          currency: services.currency,
          priceAmount: services.priceAmount,
          billingCycle: services.billingCycle,
          billingStartDate: services.billingStartDate,
          nextDueDate: services.nextDueDate,
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

    const linkedResources = await this.findResourceLinks(rows.map((row) => row.id))

    return {
      rows: rows.map<ApiService>((row) => ({
        id: row.id,
        serviceNumber: row.serviceNumber,
        name: row.name,
        planId: row.planId,
        planName: row.planName,
        planInclusions: row.planInclusions,
        status: row.status,
        currency: row.currency,
        priceAmount: row.priceAmount.toString(),
        billingCycle: row.billingCycle,
        billingStartDate: row.billingStartDate,
        nextDueDate: row.hasBillingRun ? row.nextDueDate : row.billingStartDate,
        customerId: row.customerId,
        customerName: row.customerName,
        customerNumber: row.customerNumber,
        resources: linkedResources.get(row.id) ?? [],
      })),
      total: totals[0]?.total ?? 0,
    }
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
          id: coolifyResources.id,
          name: coolifyResources.name,
          status: coolifyResources.status,
          serverName: coolifyServers.name,
          projectName: coolifyResources.projectName,
          environmentName: coolifyResources.environmentName,
        })
        .from(coolifyResources)
        .innerJoin(coolifyServers, eq(coolifyServers.id, coolifyResources.coolifyServerId))
        .where(
          and(
            eq(coolifyResources.classification, 'billable'),
            notExists(
              this.database
                .select({ id: serviceResources.id })
                .from(serviceResources)
                .innerJoin(services, eq(services.id, serviceResources.serviceId))
                .where(
                  and(
                    eq(serviceResources.resourceId, coolifyResources.id),
                    ne(services.status, 'cancelled'),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(coolifyServers.name), asc(coolifyResources.name)),
    ])

    return { plans: planRows, customers: customerRows, resources: resourceRows }
  }

  async findActiveCustomer(transaction: QueryExecutor, id: string) {
    const [customer] = await transaction
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.status, 'active')))
      .limit(1)
    return customer ?? null
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
      .select({ id: coolifyResources.id })
      .from(coolifyResources)
      .where(
        and(inArray(coolifyResources.id, ids), eq(coolifyResources.classification, 'billable')),
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

  async findAssignedResourceIds(transaction: QueryExecutor, ids: string[]) {
    if (ids.length === 0) return []
    const rows = await transaction
      .select({ id: serviceResources.resourceId })
      .from(serviceResources)
      .innerJoin(services, eq(services.id, serviceResources.serviceId))
      .where(and(inArray(serviceResources.resourceId, ids), ne(services.status, 'cancelled')))
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

  private async findResourceLinks(serviceIds: string[]) {
    const links = new Map<string, ApiServiceResourceLink[]>()
    if (serviceIds.length === 0) return links

    const rows = await this.database
      .select({
        serviceId: serviceResources.serviceId,
        resourceId: coolifyResources.id,
        name: coolifyResources.name,
        status: coolifyResources.status,
      })
      .from(serviceResources)
      .innerJoin(coolifyResources, eq(coolifyResources.id, serviceResources.resourceId))
      .where(inArray(serviceResources.serviceId, serviceIds))

    for (const row of rows) {
      const existing = links.get(row.serviceId) ?? []
      existing.push({ id: row.resourceId, name: row.name, status: row.status })
      links.set(row.serviceId, existing)
    }

    return links
  }
}
