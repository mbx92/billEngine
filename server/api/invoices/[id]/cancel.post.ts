import { InvoiceService } from '../../../services/invoices/invoice-service'
import { requestActor } from '../../../utils/actor'
import { DomainError } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw DomainError.notFound('Invoice tidak ditemukan.')

  const invoice = await new InvoiceService().cancel(id, requestActor(event, session.user.id))
  // Invoice money columns are native BigInt; never return the raw row as JSON.
  return {
    data: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
    },
  }
})
