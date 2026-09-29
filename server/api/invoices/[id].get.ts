import type { ApiInvoiceDetail } from '../../../shared/types/api'
import { InvoiceService } from '../../services/invoices/invoice-service'
import { todayIsoDate } from '../../utils/clock'
import { useBillingConfig } from '../../utils/billing-config'
import { daysPastDue } from '../../services/billing/cycles'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw DomainError.notFound('Invoice tidak ditemukan.')

  const detail = await new InvoiceService().detail(id)
  if (!detail) throw DomainError.notFound('Invoice tidak ditemukan.')

  const { invoice, items, payments } = detail
  const today = todayIsoDate((await useBillingConfig()).timezone)

  const data: ApiInvoiceDetail = {
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
  }

  return { data }
})
