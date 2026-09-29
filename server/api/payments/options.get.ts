import type { ApiPaymentInvoiceOption } from '../../../shared/types/api'
import { PaymentService } from '../../services/payments/payment-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const rows = await new PaymentService().listCollectibleInvoices()

  const data: ApiPaymentInvoiceOption[] = rows.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status as ApiPaymentInvoiceOption['status'],
    currency: invoice.currency,
    balanceDue: invoice.balanceDue.toString(),
    dueDate: invoice.dueDate,
    customerName: invoice.customerName,
    customerCompanyName: invoice.customerCompanyName,
  }))

  return { data }
})
