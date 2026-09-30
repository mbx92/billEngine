import { eq } from 'drizzle-orm'
import type { InvoiceStatus } from '../../../shared/constants/domain'
import type {
  CreateInvoiceInput,
  GenerateRecurringInvoicesInput,
} from '../../../shared/schemas/invoices'
import { useDatabase, type Database } from '../../database/client'
import { serviceBillingRuns } from '../../database/schema'
import { AuditLogRepository } from '../../repositories/audit'
import { CustomerRepository } from '../../repositories/customers'
import { allocateDocumentNumber } from '../../repositories/document-sequences'
import { InvoiceRepository, type NewInvoiceItem } from '../../repositories/invoices'
import { ServiceRepository } from '../../repositories/services'
import { useBillingConfig } from '../../utils/billing-config'
import { todayIsoDate } from '../../utils/clock'
import { DomainError } from '../../utils/errors'
import { addDays, billingPeriod, nextBillingDate } from '../billing/cycles'
import { computeInvoiceTotals, type ComputedInvoiceTotals } from '../billing/invoice-math'
import { formatInvoiceNumber, periodKeyOf } from '../../utils/document-number'

export interface ActorContext {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface RecurringRunResult {
  asOf: string
  created: Array<{ serviceId: string; invoiceId: string; invoiceNumber: string }>
  skipped: Array<{ serviceId: string; reason: string }>
  processed: number
}

export interface InvoiceListFilters {
  status?: InvoiceStatus
  customerId?: string
  query?: string
}

type DueService = Awaited<ReturnType<InvoiceRepository['listDueServices']>>[number]

export class InvoiceService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly invoices = new InvoiceRepository(database),
    private readonly customers = new CustomerRepository(database),
    private readonly services = new ServiceRepository(database),
    private readonly audit = new AuditLogRepository(database),
  ) {}

  list(page: number, perPage: number, filters: InvoiceListFilters = {}) {
    return this.invoices.list(page, perPage, filters)
  }

  statusCounts() {
    return this.invoices.statusCounts()
  }

  /** Unpaid amount per currency, used for the list summary strip. */
  async openBalance() {
    const rows = await this.invoices.balanceTotalsByCurrency()
    return rows.map((row) => ({ currency: row.currency, balance: BigInt(row.balance) }))
  }

  detail(id: string) {
    return this.invoices.findDetail(id)
  }

  /** Creates a manual invoice for one customer, snapshotting everything. */
  async createManual(input: CreateInvoiceInput, actor: ActorContext) {
    if (input.dueDate < input.issueDate) {
      throw DomainError.validation('Due date tidak boleh sebelum issue date.')
    }

    const customer = await this.customers.findById(input.customerId)
    if (!customer) throw DomainError.notFound('Customer tidak ditemukan.')
    if (customer.status !== 'active') {
      throw DomainError.invalidState('Manual invoice hanya dapat dibuat untuk customer aktif.')
    }

    const serviceIds = [
      ...new Set(input.items.flatMap((item) => (item.serviceId ? [item.serviceId] : []))),
    ]
    const validServiceIds = await this.services.findActiveCustomerServiceIds(
      this.database,
      customer.id,
      serviceIds,
    )
    if (validServiceIds.length !== serviceIds.length) {
      throw DomainError.validation(
        'Satu atau lebih service tidak aktif atau bukan milik customer yang dipilih.',
      )
    }

    const config = await useBillingConfig()
    const totals = computeInvoiceTotals(
      input.items.map((item) => ({
        quantity: item.quantity,
        unitPriceAmount: item.unitPriceAmount,
        taxRate: item.taxRate ?? config.defaultTaxRate,
      })),
    )

    if (totals.totalAmount <= 0n) {
      throw DomainError.validation('Total invoice harus lebih dari 0.')
    }

    return this.database.transaction(async (transaction) => {
      const year = periodKeyOf(input.issueDate)
      const sequence = await allocateDocumentNumber(transaction, 'invoice', year)
      const invoiceNumber = formatInvoiceNumber(year, sequence)

      const items: NewInvoiceItem[] = totals.lines.map((line, index) => {
        const inputItem = input.items[index]!

        return {
          serviceId: inputItem.serviceId ?? null,
          description: inputItem.description,
          quantity: line.quantity,
          unitPriceAmount: line.unitPriceAmount,
          subtotalAmount: line.subtotalAmount,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          totalAmount: line.totalAmount,
          servicePeriodStart: inputItem.servicePeriodStart ?? null,
          servicePeriodEnd: inputItem.servicePeriodEnd ?? null,
        }
      })

      const created = await this.invoices.createWithItems(
        transaction,
        {
          customerId: customer.id,
          invoiceNumber,
          currency: config.currency,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          subtotalAmount: totals.subtotalAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          balanceDue: totals.totalAmount,
          customerName: customer.name,
          customerCompanyName: customer.companyName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          customerAddress: formatCustomerAddress(customer),
          customerTaxId: customer.taxId,
          sellerName: config.seller.name,
          sellerAddress: config.seller.address,
          sellerEmail: config.seller.email,
          sellerTaxId: config.seller.taxId,
          notes: input.notes ?? null,
        },
        items,
        null,
      )

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: created.id,
        afterData: {
          invoiceNumber: created.invoiceNumber,
          totalAmount: created.totalAmount.toString(),
          itemCount: items.length,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return created
    })
  }

  /**
   * Generates recurring invoices for every service that has come due.
   *
   * Idempotency works in two layers:
   *  1. `service_billing_runs` unique(service_id, period_start, period_end)
   *     turns a repeat run for the same period into a no-op.
   *  2. `next_due_date` only advances after a successful insert.
   * Both writes commit in the same transaction as the invoice itself.
   */
  async generateRecurring(
    input: GenerateRecurringInvoicesInput,
    actor: ActorContext,
  ): Promise<RecurringRunResult> {
    const config = await useBillingConfig()
    if (!config.billingAutomationEnabled) {
      throw DomainError.invalidState(
        'Billing automation sedang nonaktif. Aktifkan melalui Settings sebelum menjalankan recurring billing.',
      )
    }
    const asOf = input.asOf ?? todayIsoDate(config.timezone)
    const dueServices = await this.invoices.listDueServices(asOf)

    const result: RecurringRunResult = { asOf, created: [], skipped: [], processed: 0 }

    for (const service of dueServices.slice(0, input.limit)) {
      const billingDate = service.hasBillingRun ? service.nextDueDate : service.billingStartDate

      if (!billingDate) {
        result.skipped.push({ serviceId: service.id, reason: 'jadwal invoice kosong' })
        result.processed += 1
        continue
      }

      const period = billingPeriod(billingDate, service.billingCycle)
      if (!period) {
        result.skipped.push({ serviceId: service.id, reason: 'periode billing tidak valid' })
        result.processed += 1
        continue
      }

      if (await this.invoices.findBillingRun(service.id, period.start, period.end)) {
        result.skipped.push({ serviceId: service.id, reason: 'invoice periode ini sudah ada' })
        result.processed += 1
        continue
      }
      const totals = computeInvoiceTotals([
        { quantity: '1', unitPriceAmount: service.priceAmount, taxRate: service.taxRate },
      ])

      try {
        const created = await this.createRecurringInvoice(
          service,
          period,
          totals,
          asOf,
          billingDate,
          actor,
        )
        result.created.push({
          serviceId: service.id,
          invoiceId: created.id,
          invoiceNumber: created.invoiceNumber,
        })
      } catch (error) {
        result.skipped.push({
          serviceId: service.id,
          reason: error instanceof Error ? error.message : 'gagal membuat invoice',
        })
      }

      result.processed += 1
    }

    return result
  }

  private async createRecurringInvoice(
    service: DueService,
    period: { start: string; end: string },
    totals: ComputedInvoiceTotals,
    issueDate: string,
    billingDate: string,
    actor: ActorContext,
  ) {
    const customer = await this.customers.findById(service.customerId)
    if (!customer) throw new Error('Customer tidak ditemukan.')

    const config = await useBillingConfig()
    const dueDate = addDays(issueDate, service.paymentDueDays)
    const advanced = nextBillingDate(billingDate, service.billingCycle)

    return this.database.transaction(async (transaction) => {
      // Re-check inside the transaction so a concurrent run cannot allocate the
      // same period twice.
      if (await this.invoices.findBillingRun(service.id, period.start, period.end, transaction)) {
        throw new Error('invoice periode ini sudah ada')
      }

      const year = periodKeyOf(issueDate)
      const sequence = await allocateDocumentNumber(transaction, 'invoice', year)

      const items: NewInvoiceItem[] = totals.lines.map((line) => ({
        serviceId: service.id,
        description: `${service.name} (${period.start} – ${period.end})`,
        quantity: line.quantity,
        unitPriceAmount: line.unitPriceAmount,
        subtotalAmount: line.subtotalAmount,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        totalAmount: line.totalAmount,
        servicePeriodStart: period.start,
        servicePeriodEnd: period.end,
      }))

      const created = await this.invoices.createWithItems(
        transaction,
        {
          customerId: customer.id,
          invoiceNumber: formatInvoiceNumber(year, sequence),
          currency: service.currency,
          issueDate,
          dueDate,
          subtotalAmount: totals.subtotalAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          balanceDue: totals.totalAmount,
          customerName: customer.name,
          customerCompanyName: customer.companyName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          customerAddress: formatCustomerAddress(customer),
          customerTaxId: customer.taxId,
          sellerName: config.seller.name,
          sellerAddress: config.seller.address,
          sellerEmail: config.seller.email,
          sellerTaxId: config.seller.taxId,
          notes: null,
        },
        items,
        { serviceId: service.id, periodStart: period.start, periodEnd: period.end },
      )

      await this.invoices.advanceNextDueDate(transaction, service.id, advanced)

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'invoice.generated',
        entityType: 'invoice',
        entityId: created.id,
        afterData: {
          invoiceNumber: created.invoiceNumber,
          serviceId: service.id,
          period,
          nextDueDate: advanced,
          totalAmount: created.totalAmount.toString(),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return created
    })
  }

  /**
   * Cancels an issued invoice. The billing run is removed and the service's
   * `next_due_date` is rolled back, so the scheduler can re-bill that period.
   * Paid invoices are protected (docs §19).
   */
  async cancel(id: string, actor: ActorContext) {
    return this.database.transaction(async (transaction) => {
      const existing = await this.invoices.findById(id, transaction)
      if (!existing) throw DomainError.notFound('Invoice tidak ditemukan.')

      if (existing.status === 'paid') {
        throw DomainError.invalidState(
          'Invoice yang sudah dibayar tidak dapat dibatalkan. Catat refund melalui audit.',
        )
      }
      if (existing.amountPaid > 0n) {
        throw DomainError.invalidState(
          'Invoice dengan pembayaran tidak dapat dibatalkan sebelum pembayaran direfund.',
        )
      }
      if (existing.creditedAmount > 0n) {
        throw DomainError.invalidState(
          'Invoice dengan credit note tidak dapat dibatalkan untuk menjaga audit finansial.',
        )
      }
      if (existing.status === 'cancelled') {
        throw DomainError.invalidState('Invoice sudah dibatalkan.')
      }

      const [billingRun] = await transaction
        .select()
        .from(serviceBillingRuns)
        .where(eq(serviceBillingRuns.invoiceId, id))
        .limit(1)

      const cancelled = await this.invoices.cancel(transaction, id)
      if (!cancelled) throw DomainError.invalidState('Invoice tidak dapat dibatalkan.')

      let restoredNextDueDate: string | null = null

      if (billingRun) {
        await transaction.delete(serviceBillingRuns).where(eq(serviceBillingRuns.id, billingRun.id))
        await this.invoices.advanceNextDueDate(
          transaction,
          billingRun.serviceId,
          billingRun.periodStart,
        )
        restoredNextDueDate = billingRun.periodStart
      }

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'invoice.cancelled',
        entityType: 'invoice',
        entityId: id,
        beforeData: { status: existing.status, balanceDue: existing.balanceDue.toString() },
        afterData: { status: 'cancelled', restoredNextDueDate },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return cancelled
    })
  }

  /** Flags issued invoices past their due date. Safe to run repeatedly. */
  async markOverdue(asOf: string, actor: ActorContext) {
    const affected = await this.invoices.markOverdue(asOf)

    if (affected.length > 0) {
      await this.database.transaction(async (transaction) => {
        await this.audit.record(transaction, {
          actorUserId: actor.userId,
          action: 'invoice.overdue_marked',
          entityType: 'invoice',
          entityId: null,
          afterData: { asOf, count: affected.length },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })
      })
    }

    return { asOf, marked: affected.length, invoiceIds: affected }
  }
}

function formatCustomerAddress(customer: {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  countryCode: string
}): string | null {
  const parts = [
    customer.addressLine1,
    customer.addressLine2,
    customer.city,
    customer.province,
    customer.postalCode,
    customer.countryCode,
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(', ') : null
}
