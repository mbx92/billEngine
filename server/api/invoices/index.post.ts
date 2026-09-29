import { createInvoiceSchema } from '../../../shared/schemas/invoices'
import { InvoiceService } from '../../services/invoices/invoice-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = createInvoiceSchema.parse(await readBody(event))
  const invoice = await new InvoiceService().createManual(
    input,
    requestActor(event, session.user.id),
  )

  setResponseStatus(event, 201)
  return { data: invoice }
})
