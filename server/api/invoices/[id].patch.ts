import { uuidSchema } from '../../../shared/schemas/common'
import { updateInvoiceSchema } from '../../../shared/schemas/invoices'
import { InvoiceService } from '../../services/invoices/invoice-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = updateInvoiceSchema.parse(await readBody(event))
  const invoice = await new InvoiceService().update(
    id,
    input,
    requestActor(event, session.user.id),
  )

  return {
    data: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
    },
  }
})
