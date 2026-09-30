import { InvoiceService } from '../../services/invoices/invoice-service'
import { serializeInvoiceDetail } from '../../services/invoices/serialize'
import { todayIsoDate } from '../../utils/clock'
import { useBillingConfig } from '../../utils/billing-config'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw DomainError.notFound('Invoice tidak ditemukan.')

  const detail = await new InvoiceService().detail(id)
  if (!detail) throw DomainError.notFound('Invoice tidak ditemukan.')

  const today = todayIsoDate((await useBillingConfig()).timezone)
  return { data: serializeInvoiceDetail(detail, today) }
})
