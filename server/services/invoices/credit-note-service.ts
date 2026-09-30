import type { CreateCreditNoteInput } from '../../../shared/schemas/invoices'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository } from '../../repositories/audit'
import { CreditNoteRepository } from '../../repositories/credit-notes'
import { allocateDocumentNumber } from '../../repositories/document-sequences'
import { InvoiceRepository } from '../../repositories/invoices'
import { PaymentRepository } from '../../repositories/payments'
import { todayIsoDate } from '../../utils/clock'
import { formatDocumentNumber } from '../../utils/document-number'
import { DomainError } from '../../utils/errors'
import { useBillingConfig } from '../../utils/billing-config'
import { daysPastDue } from '../billing/cycles'
import { invoiceStateFromNet, summarizePaymentEffect } from '../payments/status'
import type { ActorContext } from './invoice-service'

export class CreditNoteService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly credits = new CreditNoteRepository(database),
    private readonly invoices = new InvoiceRepository(database),
    private readonly payments = new PaymentRepository(database),
    private readonly audit = new AuditLogRepository(database),
  ) {}

  async create(invoiceId: string, input: CreateCreditNoteInput, actor: ActorContext) {
    const config = await useBillingConfig()
    const today = todayIsoDate(config.timezone)

    return this.database.transaction(async (transaction) => {
      const invoice = await this.invoices.findByIdForUpdate(invoiceId, transaction)
      if (!invoice) throw DomainError.notFound('Invoice tidak ditemukan.')
      if (invoice.status === 'draft' || invoice.status === 'cancelled') {
        throw DomainError.invalidState('Credit note hanya dapat dibuat untuk invoice aktif.')
      }
      if (input.amount > invoice.balanceDue) {
        throw DomainError.validation(
          `Jumlah credit note melebihi sisa tagihan (${invoice.balanceDue.toString()}).`,
        )
      }

      const sequence = await allocateDocumentNumber(transaction, 'credit_note', today.slice(0, 4))
      const credit = await this.credits.create(transaction, {
        invoiceId,
        creditNoteNumber: formatDocumentNumber('CRN', sequence),
        amount: input.amount,
        reason: input.reason,
        createdBy: actor.userId,
      })
      const paymentRows = await this.payments.listByInvoice(transaction, invoiceId)
      const netPaid = summarizePaymentEffect(paymentRows).net
      const creditedAmount = invoice.creditedAmount + input.amount
      const effectiveTotal = invoice.totalAmount - creditedAmount
      const state = invoiceStateFromNet(
        effectiveTotal,
        netPaid,
        daysPastDue(invoice.dueDate, today) > 0,
      )
      const updatedInvoice = await this.invoices.applyCreditState(transaction, invoiceId, {
        creditedAmount,
        ...state,
      })

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'credit_note.issued',
        entityType: 'credit_note',
        entityId: credit.id,
        beforeData: {
          creditedAmount: invoice.creditedAmount.toString(),
          balanceDue: invoice.balanceDue.toString(),
        },
        afterData: {
          creditNoteNumber: credit.creditNoteNumber,
          amount: credit.amount.toString(),
          creditedAmount: updatedInvoice.creditedAmount.toString(),
          balanceDue: updatedInvoice.balanceDue.toString(),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return { credit, invoice: updatedInvoice }
    })
  }
}
