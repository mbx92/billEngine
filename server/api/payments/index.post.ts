import { recordPaymentSchema } from '../../../shared/schemas/invoices'
import { PaymentService } from '../../services/payments/payment-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = recordPaymentSchema.parse(await readBody(event))
  const result = await new PaymentService().record(input, requestActor(event, session.user.id))

  setResponseStatus(event, 201)
  return {
    data: {
      payment: {
        id: result.payment.id,
        paymentNumber: result.payment.paymentNumber,
        amount: result.payment.amount.toString(),
        status: result.payment.status,
        currency: result.payment.currency,
        method: result.payment.method,
        reference: result.payment.reference,
        paidAt: result.payment.paidAt.toISOString(),
      },
      invoice: {
        id: result.invoice.id,
        status: result.invoice.status,
        amountPaid: result.invoice.amountPaid.toString(),
        balanceDue: result.invoice.balanceDue.toString(),
      },
    },
  }
})
