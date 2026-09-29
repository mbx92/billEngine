import { uuidSchema } from '../../../../shared/schemas/common'
import { InvoiceService } from '../../../services/invoices/invoice-service'
import { generateInvoicePdf } from '../../../services/invoices/invoice-pdf-service'
import { DomainError } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const detail = await new InvoiceService().detail(id)
  if (!detail) throw DomainError.notFound('Invoice tidak ditemukan.')

  const pdf = await generateInvoicePdf(detail)
  const filename = `${detail.invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`

  setResponseHeaders(event, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': pdf.byteLength,
    'cache-control': 'private, no-store',
  })
  return send(event, pdf)
})
