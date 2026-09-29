import { invoiceListQuerySchema } from '../../../shared/schemas/invoices'
import type { ApiInvoiceListItem, ApiInvoiceSummary } from '../../../shared/types/api'
import { InvoiceService } from '../../services/invoices/invoice-service'
import { daysPastDue } from '../../services/billing/cycles'
import { todayIsoDate } from '../../utils/clock'
import { useBillingConfig } from '../../utils/billing-config'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = invoiceListQuerySchema.parse(getQuery(event))
  const service = new InvoiceService()

  const [{ rows, total }, counts, balances] = await Promise.all([
    service.list(query.page, query.perPage, {
      status: query.status,
      customerId: query.customerId,
      query: query.query,
    }),
    service.statusCounts(),
    service.openBalance(),
  ])

  const today = todayIsoDate((await useBillingConfig()).timezone)
  const summary: ApiInvoiceSummary = {
    counts,
    currencies: balances.map((entry) => ({
      currency: entry.currency,
      balance: entry.balance.toString(),
    })),
  }

  const data: ApiInvoiceListItem[] = rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    currency: row.currency,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    totalAmount: row.totalAmount.toString(),
    amountPaid: row.amountPaid.toString(),
    balanceDue: row.balanceDue.toString(),
    customerId: row.customerId,
    customerName: row.customerName,
    customerCompanyName: row.customerCompanyName,
    daysPastDue: daysPastDue(row.dueDate, today),
  }))

  return {
    data,
    summary,
    meta: {
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: Math.ceil(total / query.perPage),
    },
  }
})
