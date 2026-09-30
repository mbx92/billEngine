import { uuidSchema } from '../../../../shared/schemas/common'
import { createCreditNoteSchema } from '../../../../shared/schemas/invoices'
import { CreditNoteService } from '../../../services/invoices/credit-note-service'
import { requestActor } from '../../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const invoiceId = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = createCreditNoteSchema.parse(await readBody(event))
  const result = await new CreditNoteService().create(
    invoiceId,
    input,
    requestActor(event, session.user.id),
  )

  setResponseStatus(event, 201)
  return {
    data: {
      creditNote: {
        id: result.credit.id,
        creditNoteNumber: result.credit.creditNoteNumber,
        amount: result.credit.amount.toString(),
        reason: result.credit.reason,
        status: result.credit.status,
        issuedAt: result.credit.issuedAt.toISOString(),
      },
      invoice: {
        status: result.invoice.status,
        creditedAmount: result.invoice.creditedAmount.toString(),
        balanceDue: result.invoice.balanceDue.toString(),
      },
    },
  }
})
