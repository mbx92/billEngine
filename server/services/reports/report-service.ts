import { and, count, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import type { ReportRangeInput } from '../../../shared/schemas/reports'
import type { ApiReportSummary } from '../../../shared/types/api'
import { useDatabase, type Database } from '../../database/client'
import { invoices, payments } from '../../database/schema'

export class ReportService {
  constructor(private readonly database: Database = useDatabase()) {}

  async summary(range: ReportRangeInput): Promise<ApiReportSummary> {
    const invoiceConditions = [ne(invoices.status, 'cancelled')]
    if (range.from) invoiceConditions.push(gte(invoices.issueDate, range.from))
    if (range.to) invoiceConditions.push(lte(invoices.issueDate, range.to))

    const paymentConditions = [inArray(payments.status, ['completed', 'refunded'])]
    if (range.from) {
      paymentConditions.push(sql`${payments.paidAt} >= ${range.from}::date`)
    }
    if (range.to) {
      paymentConditions.push(sql`${payments.paidAt} < (${range.to}::date + 1)`)
    }

    const [invoiced, collected, outstanding, monthlyInvoices, monthlyPayments] = await Promise.all([
      this.database
        .select({
          currency: invoices.currency,
          amount: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)`,
          total: count(),
        })
        .from(invoices)
        .where(and(...invoiceConditions))
        .groupBy(invoices.currency),
      this.database
        .select({
          currency: payments.currency,
          amount: sql<string>`coalesce(sum(case when ${payments.status} = 'refunded' then -${payments.amount} else ${payments.amount} end), 0)`,
        })
        .from(payments)
        .where(and(...paymentConditions))
        .groupBy(payments.currency),
      this.database
        .select({
          currency: invoices.currency,
          amount: sql<string>`coalesce(sum(${invoices.balanceDue}), 0)`,
        })
        .from(invoices)
        .where(and(inArray(invoices.status, ['unpaid', 'overdue']), ...invoiceConditions.slice(1)))
        .groupBy(invoices.currency),
      this.database
        .select({
          month: sql<string>`to_char(${invoices.issueDate}, 'YYYY-MM')`,
          currency: invoices.currency,
          amount: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)`,
        })
        .from(invoices)
        .where(and(...invoiceConditions))
        .groupBy(sql`to_char(${invoices.issueDate}, 'YYYY-MM')`, invoices.currency),
      this.database
        .select({
          month: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM')`,
          currency: payments.currency,
          amount: sql<string>`coalesce(sum(case when ${payments.status} = 'refunded' then -${payments.amount} else ${payments.amount} end), 0)`,
        })
        .from(payments)
        .where(and(...paymentConditions))
        .groupBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`, payments.currency),
    ])

    const monthly = new Map<
      string,
      { month: string; currency: string; invoiced: string; collected: string }
    >()
    for (const row of monthlyInvoices) {
      monthly.set(`${row.month}:${row.currency}`, {
        month: row.month,
        currency: row.currency,
        invoiced: row.amount,
        collected: '0',
      })
    }
    for (const row of monthlyPayments) {
      const key = `${row.month}:${row.currency}`
      const existing = monthly.get(key)
      monthly.set(key, {
        month: row.month,
        currency: row.currency,
        invoiced: existing?.invoiced ?? '0',
        collected: row.amount,
      })
    }

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      invoiced: invoiced.map((row) => ({
        currency: row.currency,
        amount: row.amount,
        count: Number(row.total),
      })),
      collected,
      outstanding,
      monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    }
  }

  async csv(range: ReportRangeInput) {
    const report = await this.summary(range)
    const rows = [
      ['month', 'currency', 'invoiced', 'collected'],
      ...report.monthly.map((row) => [row.month, row.currency, row.invoiced, row.collected]),
    ]
    return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
  }
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
