import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import type { InvoiceStatus } from '../../shared/constants/domain'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { invoiceItems, invoices, payments, serviceBillingRuns, services } from '../database/schema'

export type InvoiceRecord = typeof invoices.$inferSelect
export type InvoiceItemRecord = typeof invoiceItems.$inferSelect
export type ServiceBillingRunRecord = typeof serviceBillingRuns.$inferSelect

export interface InvoiceListFilters {
  status?: InvoiceStatus
  customerId?: string
  query?: string
}

export interface NewInvoiceItem {
  serviceId: string | null
  description: string
  quantity: string
  unitPriceAmount: bigint
  subtotalAmount: bigint
  taxRate: string | null
  taxAmount: bigint
  totalAmount: bigint
  servicePeriodStart: string | null
  servicePeriodEnd: string | null
}

export interface NewInvoice {
  customerId: string
  invoiceNumber: string
  currency: string
  issueDate: string
  dueDate: string
  subtotalAmount: bigint
  taxAmount: bigint
  totalAmount: bigint
  balanceDue: bigint
  customerName: string
  customerCompanyName: string | null
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  customerTaxId: string | null
  sellerName: string
  sellerAddress: string | null
  sellerEmail: string | null
  sellerTaxId: string | null
  notes: string | null
}

export class InvoiceRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async list(page: number, perPage: number, filters: InvoiceListFilters = {}) {
    const offset = (page - 1) * perPage
    const conditions = []

    if (filters.status) conditions.push(eq(invoices.status, filters.status))
    if (filters.customerId) conditions.push(eq(invoices.customerId, filters.customerId))
    if (filters.query) {
      const pattern = `%${filters.query}%`
      conditions.push(
        or(
          ilike(invoices.invoiceNumber, pattern),
          ilike(invoices.customerName, pattern),
          ilike(invoices.customerCompanyName, pattern),
        ),
      )
    }

    const where = conditions.length ? and(...conditions) : undefined

    const [rows, totals] = await Promise.all([
      this.database
        .select()
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.issueDate), desc(invoices.invoiceNumber))
        .limit(perPage)
        .offset(offset),
      this.database.select({ total: count() }).from(invoices).where(where),
    ])

    return { rows, total: totals[0]?.total ?? 0 }
  }

  /** Status counts for the list filter chips, computed over all invoices. */
  async statusCounts(): Promise<Record<InvoiceStatus, number>> {
    const rows = await this.database
      .select({ status: invoices.status, total: count() })
      .from(invoices)
      .groupBy(invoices.status)

    const counts: Record<InvoiceStatus, number> = {
      draft: 0,
      unpaid: 0,
      paid: 0,
      overdue: 0,
      cancelled: 0,
    }

    for (const row of rows) counts[row.status] = Number(row.total)
    return counts
  }

  async findById(id: string, database: Transaction | Database = this.database) {
    const [invoice] = await database.select().from(invoices).where(eq(invoices.id, id)).limit(1)

    return invoice ?? null
  }

  async findDetail(id: string) {
    const invoice = await this.findById(id)
    if (!invoice) return null

    const [items, invoicePayments] = await Promise.all([
      this.database
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, id))
        .orderBy(asc(invoiceItems.createdAt)),
      this.database
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, id))
        .orderBy(desc(payments.paidAt)),
    ])

    return { invoice, items, payments: invoicePayments }
  }

  async findByNumber(invoiceNumber: string) {
    const [invoice] = await this.database
      .select()
      .from(invoices)
      .where(eq(invoices.invoiceNumber, invoiceNumber))
      .limit(1)

    return invoice ?? null
  }

  /** Issued invoices that can still receive a manual payment. */
  async listCollectible() {
    return this.database
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        currency: invoices.currency,
        balanceDue: invoices.balanceDue,
        dueDate: invoices.dueDate,
        customerName: invoices.customerName,
        customerCompanyName: invoices.customerCompanyName,
      })
      .from(invoices)
      .where(inArray(invoices.status, ['unpaid', 'overdue']))
      .orderBy(asc(invoices.dueDate), asc(invoices.invoiceNumber))
  }

  /** Finds an existing billing run for an exact service period (idempotency). */
  async findBillingRun(
    serviceId: string,
    periodStart: string,
    periodEnd: string,
    database: Transaction | Database = this.database,
  ) {
    const [run] = await database
      .select()
      .from(serviceBillingRuns)
      .where(
        and(
          eq(serviceBillingRuns.serviceId, serviceId),
          eq(serviceBillingRuns.periodStart, periodStart),
          eq(serviceBillingRuns.periodEnd, periodEnd),
        ),
      )
      .limit(1)

    return run ?? null
  }

  async findBillingRunsForService(serviceIds: string[]) {
    if (serviceIds.length === 0) return []
    return this.database
      .select()
      .from(serviceBillingRuns)
      .where(inArray(serviceBillingRuns.serviceId, serviceIds))
  }

  /**
   * Writes the invoice header, its items, and the idempotency marker as one
   * financial transaction (docs §18).
   */
  async createWithItems(
    transaction: Transaction,
    invoice: NewInvoice,
    items: NewInvoiceItem[],
    billingRun: { serviceId: string; periodStart: string; periodEnd: string } | null,
  ): Promise<InvoiceRecord> {
    const [created] = await transaction
      .insert(invoices)
      .values({
        ...invoice,
        status: 'unpaid',
        amountPaid: 0n,
        issuedAt: new Date(),
      })
      .returning()

    if (!created) throw new Error('Failed to create invoice.')

    await transaction
      .insert(invoiceItems)
      .values(items.map((item) => ({ ...item, invoiceId: created.id })))

    if (billingRun) {
      const insertedBillingRuns = await transaction
        .insert(serviceBillingRuns)
        .values({ ...billingRun, invoiceId: created.id })
        .onConflictDoNothing()
        .returning({ id: serviceBillingRuns.id })

      if (insertedBillingRuns.length === 0) {
        // A concurrent generator won the unique service/period claim. Throwing
        // rolls this transaction (including the invoice and sequence) back.
        throw new Error('invoice periode ini sudah ada')
      }
    }

    return created
  }

  /** Recomputes invoice payment state; called inside the payment transaction. */
  async applyPaymentState(
    transaction: Transaction,
    invoiceId: string,
    state: { amountPaid: bigint; balanceDue: bigint; status: InvoiceStatus },
  ) {
    const [updated] = await transaction
      .update(invoices)
      .set({
        amountPaid: state.amountPaid,
        balanceDue: state.balanceDue,
        status: state.status,
        paidAt: state.status === 'paid' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning()

    if (!updated) throw new Error('Failed to update invoice payment state.')
    return updated
  }

  /** Flags issued invoices whose due date has passed. Returns affected ids. */
  async markOverdue(today: string): Promise<string[]> {
    const rows = await this.database
      .update(invoices)
      .set({ status: 'overdue', updatedAt: new Date() })
      .where(and(eq(invoices.status, 'unpaid'), lt(invoices.dueDate, today)))
      .returning({ id: invoices.id, customerId: invoices.customerId })

    return rows.map((row) => row.id)
  }

  async cancel(transaction: Transaction, id: string) {
    const [updated] = await transaction
      .update(invoices)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, id), inArray(invoices.status, ['draft', 'unpaid', 'overdue'])))
      .returning()

    return updated ?? null
  }

  async balanceTotalsByCurrency() {
    return this.database
      .select({
        currency: invoices.currency,
        balance: sql<string>`coalesce(sum(${invoices.balanceDue}), 0)`,
      })
      .from(invoices)
      .where(inArray(invoices.status, ['unpaid', 'overdue']))
      .groupBy(invoices.currency)
  }

  /** Active services whose invoice schedule has arrived on/before `today`. */
  async listDueServices(today: string) {
    const billingRun = this.database
      .select({ id: serviceBillingRuns.id })
      .from(serviceBillingRuns)
      .where(eq(serviceBillingRuns.serviceId, services.id))

    return this.database
      .select({
        id: services.id,
        customerId: services.customerId,
        serviceNumber: services.serviceNumber,
        name: services.name,
        currency: services.currency,
        priceAmount: services.priceAmount,
        billingCycle: services.billingCycle,
        billingStartDate: services.billingStartDate,
        nextDueDate: services.nextDueDate,
        hasBillingRun: exists(billingRun),
        invoiceLeadDays: services.invoiceLeadDays,
        paymentDueDays: services.paymentDueDays,
        taxRate: services.taxRate,
      })
      .from(services)
      .where(
        and(
          eq(services.status, 'active'),
          or(
            and(
              notExists(billingRun),
              sql`${services.billingStartDate} - (${services.invoiceLeadDays} * interval '1 day') <= ${today}::date`,
            ),
            and(
              exists(billingRun),
              sql`${services.nextDueDate} is not null`,
              sql`${services.nextDueDate} - (${services.invoiceLeadDays} * interval '1 day') <= ${today}::date`,
            ),
          ),
        ),
      )
      .orderBy(asc(services.billingStartDate), asc(services.nextDueDate))
  }

  async advanceNextDueDate(
    transaction: Transaction,
    serviceId: string,
    nextDueDate: string | null,
  ) {
    await transaction
      .update(services)
      .set({ nextDueDate, updatedAt: new Date() })
      .where(eq(services.id, serviceId))
  }
}
