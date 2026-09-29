import { count, ne, sql } from 'drizzle-orm'
import type { ApiDashboard } from '../../../shared/types/api'
import { useDatabase, type Database } from '../../database/client'
import { customers, invoices, services } from '../../database/schema'
import { CoolifyResourceRepository } from '../../repositories/coolify-resources'
import {
  isActiveService,
  monthlyRecurringAmount,
  summarizeInvoiceBalances,
} from '../billing/overview'

export class DashboardService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly resources = new CoolifyResourceRepository(database),
  ) {}

  async overview(): Promise<ApiDashboard> {
    const [customerTotals, serviceRows, invoiceRows, resourceSummary] = await Promise.all([
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
      this.resources.summary(),
    ])

    const activeServices = serviceRows.filter((row) => isActiveService(row.status))
    const currency = activeServices[0]?.currency ?? serviceRows[0]?.currency ?? 'IDR'
    const monthlyRecurring = activeServices.reduce(
      (sum, row) => sum + monthlyRecurringAmount(row.priceAmount, row.billingCycle),
      0n,
    )
    const balances = summarizeInvoiceBalances(invoiceRows, todayIsoDate())

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
        total: resourceSummary.total,
        running: resourceSummary.running,
        billable: resourceSummary.billable,
        notBilled: resourceSummary.notBilled,
        lastSyncedAt: resourceSummary.lastSyncedAt,
      },
      capacity: {
        cpuCores: resourceSummary.totalCpuCores,
        memoryBytes: resourceSummary.totalMemoryBytes,
        resourceCount: resourceSummary.total,
      },
    }
  }
}

/** Billing timezone decides which calendar day counts as "today". */
function todayIsoDate(): string {
  const config = useRuntimeConfig()
  const timeZone = config.billingTimezone || 'UTC'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
