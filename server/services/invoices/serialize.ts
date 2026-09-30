import type { ApiInvoiceDetail } from '../../../shared/types/api'
import type { InvoiceRepository } from '../../repositories/invoices'
import { daysPastDue } from '../billing/cycles'

type Detail = NonNullable<Awaited<ReturnType<InvoiceRepository['findDetail']>>>

export function serializeInvoiceDetail(detail: Detail, today: string): ApiInvoiceDetail {
  const { invoice, items, payments, creditNotes } = detail
  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      subtotalAmount: invoice.subtotalAmount.toString(),
      taxAmount: invoice.taxAmount.toString(),
      totalAmount: invoice.totalAmount.toString(),
      amountPaid: invoice.amountPaid.toString(),
      creditedAmount: invoice.creditedAmount.toString(),
      balanceDue: invoice.balanceDue.toString(),
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerCompanyName: invoice.customerCompanyName,
      notes: invoice.notes,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
      customerEmail: invoice.customerEmail,
      customerPhone: invoice.customerPhone,
      customerAddress: invoice.customerAddress,
      customerTaxId: invoice.customerTaxId,
      sellerName: invoice.sellerName,
      sellerAddress: invoice.sellerAddress,
      sellerEmail: invoice.sellerEmail,
      sellerTaxId: invoice.sellerTaxId,
      daysPastDue: daysPastDue(invoice.dueDate, today),
    },
    items: items.map((item) => ({
      id: item.id,
      serviceId: item.serviceId,
      description: item.description,
      quantity: item.quantity,
      unitPriceAmount: item.unitPriceAmount.toString(),
      subtotalAmount: item.subtotalAmount.toString(),
      taxRate: item.taxRate,
      taxAmount: item.taxAmount.toString(),
      totalAmount: item.totalAmount.toString(),
      servicePeriodStart: item.servicePeriodStart,
      servicePeriodEnd: item.servicePeriodEnd,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      status: payment.status,
      amount: payment.amount.toString(),
      currency: payment.currency,
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      paidAt: payment.paidAt.toISOString(),
      recordedByName: null,
    })),
    creditNotes: creditNotes.map((credit) => ({
      id: credit.id,
      creditNoteNumber: credit.creditNoteNumber,
      status: credit.status,
      amount: credit.amount.toString(),
      reason: credit.reason,
      issuedAt: credit.issuedAt.toISOString(),
    })),
  }
}
