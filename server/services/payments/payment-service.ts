import type { RecordPaymentInput } from '../../../shared/schemas/invoices'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository } from '../../repositories/audit'
import { allocateDocumentNumber } from '../../repositories/document-sequences'
import { InvoiceRepository } from '../../repositories/invoices'
import { PaymentRepository } from '../../repositories/payments'
import { todayIsoDate } from '../../utils/clock'
import { DomainError } from '../../utils/errors'
import { daysPastDue } from '../billing/cycles'
import { formatDocumentNumber } from '../../utils/document-number'
import { invoiceStateFromNet, summarizePaymentEffect } from './status'

export interface ActorContext {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface PaymentListFilters {
  invoiceId?: string
  status?: RecordPaymentInput['status']
  from?: string
  to?: string
}

export class PaymentService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly payments = new PaymentRepository(database),
    private readonly invoices = new InvoiceRepository(database),
    private readonly audit = new AuditLogRepository(database),
  ) {}

  list(page: number, perPage: number, filters: PaymentListFilters = {}) {
    return this.payments.list(page, perPage, filters)
  }

  /**
   * Records a manual payment and recomputes the invoice state in the same
   * transaction, so an invoice can never end up paid without its payment row.
   */
  async record(input: RecordPaymentInput, actor: ActorContext) {
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date(todayIsoDate())

    return this.database.transaction(async (transaction) => {
      const invoice = await this.invoices.findById(input.invoiceId, transaction)
      if (!invoice) throw DomainError.notFound('Invoice tidak ditemukan.')

      if (invoice.status === 'cancelled') {
        throw DomainError.invalidState('Invoice sudah dibatalkan dan tidak dapat menerima payment.')
      }

      if (input.status === 'completed' && invoice.status === 'paid') {
        throw DomainError.invalidState('Invoice sudah lunas.')
      }

      if (input.status === 'completed' && input.amount > invoice.balanceDue) {
        throw DomainError.validation(
          `Jumlah pembayaran melebihi sisa tagihan (${invoice.balanceDue.toString()}).`,
        )
      }

      // Only captured payments consume a document number.
      const sequence =
        input.status === 'completed'
          ? await allocateDocumentNumber(transaction, 'payment', todayIsoDate().slice(0, 4))
          : 0n

      const payment = await this.payments.create(transaction, {
        invoiceId: invoice.id,
        paymentNumber: formatDocumentNumber('PAY', sequence),
        amount: input.amount,
        currency: invoice.currency,
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        paidAt,
        status: input.status,
        recordedBy: actor.userId,
      })

      if (input.status !== 'completed') {
        // Pending/failed rows are informational only; the invoice is untouched.
        await this.audit.record(transaction, {
          actorUserId: actor.userId,
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: payment.id,
          afterData: {
            paymentNumber: payment.paymentNumber,
            amount: payment.amount.toString(),
            status: payment.status,
            invoiceId: invoice.id,
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })

        return { payment, invoice }
      }

      const rows = await this.payments.listByInvoice(transaction, invoice.id)
      const effect = summarizePaymentEffect(rows)
      const isPastDue = daysPastDue(invoice.dueDate, todayIsoDate()) > 0
      const previousStatus = invoice.status

      const updated = await this.invoices.applyPaymentState(
        transaction,
        invoice.id,
        invoiceStateFromNet(invoice.totalAmount, effect.net, isPastDue),
      )

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'payment.recorded',
        entityType: 'payment',
        entityId: payment.id,
        beforeData: { invoiceStatus: previousStatus },
        afterData: {
          paymentNumber: payment.paymentNumber,
          amount: payment.amount.toString(),
          invoiceId: invoice.id,
          invoiceStatus: updated.status,
          amountPaid: updated.amountPaid.toString(),
          balanceDue: updated.balanceDue.toString(),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return { payment, invoice: updated }
    })
  }
}
