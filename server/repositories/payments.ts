import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { PaymentStatus } from '../../shared/constants/domain'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { invoices, payments, users } from '../database/schema'

export type PaymentRecord = typeof payments.$inferSelect

export interface PaymentListFilters {
  invoiceId?: string
  status?: PaymentStatus
  from?: string
  to?: string
}

export interface NewPayment {
  invoiceId: string
  paymentNumber: string
  amount: bigint
  currency: string
  method: string
  reference: string | null
  notes: string | null
  paidAt: Date
  status: PaymentStatus
  recordedBy: string | null
}

export class PaymentRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async list(page: number, perPage: number, filters: PaymentListFilters = {}) {
    const offset = (page - 1) * perPage
    const conditions = []

    if (filters.invoiceId) conditions.push(eq(payments.invoiceId, filters.invoiceId))
    if (filters.status) conditions.push(eq(payments.status, filters.status))
    if (filters.from) conditions.push(gte(payments.paidAt, new Date(filters.from)))
    if (filters.to) conditions.push(lte(payments.paidAt, new Date(filters.to)))

    const where = conditions.length ? and(...conditions) : undefined

    const [rows, totals] = await Promise.all([
      this.database
        .select({
          payment: payments,
          invoiceNumber: invoices.invoiceNumber,
          customerName: invoices.customerName,
          customerCompanyName: invoices.customerCompanyName,
          recorderName: users.name,
        })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .leftJoin(users, eq(users.id, payments.recordedBy))
        .where(where)
        .orderBy(desc(payments.paidAt))
        .limit(perPage)
        .offset(offset),
      this.database.select({ total: count() }).from(payments).where(where),
    ])

    return { rows, total: totals[0]?.total ?? 0 }
  }

  async findById(id: string) {
    const [payment] = await this.database
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1)

    return payment ?? null
  }

  /**
   * Sums captured payments only. Failed, refunded, and cancelled records must
   * never reduce what the customer owes.
   */
  async sumCompletedPayments(database: Transaction | Database, invoiceId: string): Promise<bigint[]> {
    const rows = await database
      .select({ amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'completed')))

    return rows.map((row) => row.amount)
  }

  async create(transaction: Transaction, payment: NewPayment): Promise<PaymentRecord> {
    const [created] = await transaction.insert(payments).values(payment).returning()
    if (!created) throw new Error('Failed to record payment.')
    return created
  }

  async listByInvoice(database: Transaction | Database, invoiceId: string) {
    return database
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, invoiceId))
      .orderBy(desc(payments.paidAt))
  }

  async monthlyTotals(months: number) {
    return this.database
      .select({
        month: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM')`,
        currency: payments.currency,
        total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'completed'),
          gte(payments.paidAt, sql`date_trunc('month', now()) - (${months} * interval '1 month')`),
        ),
      )
      .groupBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`, payments.currency)
      .orderBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`)
  }
}
