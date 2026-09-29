import { paymentListQuerySchema } from '../../../shared/schemas/invoices'
import type { ApiPaymentListItem } from '../../../shared/types/api'
import { PaymentService } from '../../services/payments/payment-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = paymentListQuerySchema.parse(getQuery(event))
  const { rows, total } = await new PaymentService().list(query.page, query.perPage, {
    invoiceId: query.invoiceId,
    status: query.status,
    from: query.from,
    to: query.to,
  })

  const data: ApiPaymentListItem[] = rows.map((row) => ({
    id: row.payment.id,
    paymentNumber: row.payment.paymentNumber,
    status: row.payment.status,
    amount: row.payment.amount.toString(),
    currency: row.payment.currency,
    method: row.payment.method,
    reference: row.payment.reference,
    notes: row.payment.notes,
    paidAt: row.payment.paidAt.toISOString(),
    recordedByName: row.recorderName,
    invoiceNumber: row.invoiceNumber,
    customerName: row.customerName,
    customerCompanyName: row.customerCompanyName,
  }))

  return {
    data,
    meta: {
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: Math.ceil(total / query.perPage),
    },
  }
})
