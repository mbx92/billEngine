import { InvoiceService } from '../../services/invoices/invoice-service'
import { requestActor } from '../../utils/actor'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw DomainError.notFound('Invoice tidak ditemukan.')

  const invoice = await new InvoiceService().removeCancelled(
    id,
    requestActor(event, session.user.id),
  )
  return { data: invoice }
})
