import { count, eq, isNull, ne, sql } from 'drizzle-orm'
import type { ApiDashboard } from '../../../shared/types/api'
import { useDatabase, type Database } from '../../database/client'
import {
  customers,
  infrastructureResources,
  invoices,
  serviceResources,
  services,
} from '../../database/schema'
import {
  isActiveService,
  monthlyRecurringAmount,
  summarizeInvoiceBalances,
} from '../billing/overview'
import { useBillingConfig } from '../../utils/billing-config'
import { todayIsoDate } from '../../utils/clock'

export class DashboardService {
  constructor(private readonly database: Database = useDatabase()) {}

  async overview(): Promise<ApiDashboard> {
    const [
      customerTotals,
      serviceRows,
      invoiceRows,
      resourceRows,
      linkedResourceRows,
      billingConfig,
    ] = await Promise.all([
      this.database
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where ${customers.status} = 'active')`.mapWith(
            Number,
          ),
        })
        .from(customers),
      this.database
        .select({
          status: services.status,
          currency: services.currency,
          priceAmount: services.priceAmount,
          billingCycle: services.billingCycle,
        })
        .from(services)
        .where(ne(services.status, 'cancelled')),
      this.database
        .select({
          status: invoices.status,
          balanceDue: invoices.balanceDue,
          dueDate: invoices.dueDate,
        })
        .from(invoices),
      this.database
        .select({
          id: infrastructureResources.id,
          observedState: infrastructureResources.observedState,
          classification: infrastructureResources.classification,
          desiredSpec: infrastructureResources.desiredSpec,
          lastObservedAt: infrastructureResources.lastObservedAt,
        })
        .from(infrastructureResources)
        .where(isNull(infrastructureResources.deletedAt)),
      this.database
        .select({ resourceId: serviceResources.resourceId })
        .from(serviceResources)
        .innerJoin(services, eq(services.id, serviceResources.serviceId))
        .where(ne(services.status, 'cancelled')),
      useBillingConfig(),
    ])

    const activeServices = serviceRows.filter((row) => isActiveService(row.status))
    const currency = activeServices[0]?.currency ?? serviceRows[0]?.currency ?? 'IDR'
    const monthlyRecurring = activeServices.reduce(
      (sum, row) => sum + monthlyRecurringAmount(row.priceAmount, row.billingCycle),
      0n,
    )
    const balances = summarizeInvoiceBalances(invoiceRows, todayIsoDate(billingConfig.timezone))
    const linkedResourceIds = new Set(
      linkedResourceRows.flatMap((row) => (row.resourceId ? [row.resourceId] : [])),
    )
    const billableResources = resourceRows.filter(
      (resource) => resource.classification === 'billable',
    )
    const limits = resourceRows.map((resource) => {
      const spec = resource.desiredSpec as {
        limits?: { cpuMilli?: number; memoryBytes?: string }
      }
      return spec.limits
    })
    const totalCpuMilli = limits.reduce((total, limit) => total + BigInt(limit?.cpuMilli ?? 0), 0n)
    const totalMemoryBytes = limits.reduce(
      (total, limit) => total + BigInt(limit?.memoryBytes ?? '0'),
      0n,
    )
    const lastObservedAt = resourceRows.reduce<Date | null>(
      (latest, resource) =>
        resource.lastObservedAt && (!latest || resource.lastObservedAt > latest)
          ? resource.lastObservedAt
          : latest,
      null,
    )

    return {
      revenue: {
        monthlyRecurring: monthlyRecurring.toString(),
        currency,
      },
      customers: {
        total: customerTotals[0]?.total ?? 0,
        active: customerTotals[0]?.active ?? 0,
      },
      invoices: {
        open: balances.open,
        overdue: balances.overdue,
        unpaidBalance: balances.unpaidBalance.toString(),
      },
      resources: {
        total: resourceRows.length,
        running: resourceRows.filter((resource) => resource.observedState === 'running').length,
        billable: billableResources.length,
        notBilled: billableResources.filter((resource) => !linkedResourceIds.has(resource.id))
          .length,
        lastSyncedAt: lastObservedAt?.toISOString() ?? null,
      },
      capacity: {
        cpuCores: milliToDecimal(totalCpuMilli),
        memoryBytes: totalMemoryBytes.toString(),
        resourceCount: resourceRows.length,
      },
    }
  }
}

function milliToDecimal(value: bigint) {
  const whole = value / 1_000n
  const fraction = (value % 1_000n).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
