import { uuidSchema } from '../../../../../shared/schemas/common'
import { generateInvoicePdf } from '../../../../services/invoices/invoice-pdf-service'
import { PortalService } from '../../../../services/portal/portal-service'

export default defineEventHandler(async (event) => {
  const session = await requireCustomer(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const { raw } = await new PortalService().invoiceDetail(session.customerId, id)
  const pdf = await generateInvoicePdf(raw)
  const filename = `${raw.invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`

  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': pdf.byteLength,
    'cache-control': 'private, no-store',
  })
  return send(event, pdf)
})
