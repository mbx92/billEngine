import type { ApiPortalSummary } from '../../../shared/types/api'
import { CustomerRepository } from '../../repositories/customers'
import { InvoiceRepository } from '../../repositories/invoices'
import { ServiceRepository } from '../../repositories/services'
import { useBillingConfig } from '../../utils/billing-config'
import { todayIsoDate } from '../../utils/clock'
import { DomainError } from '../../utils/errors'
import { daysPastDue } from '../billing/cycles'
import { serializeInvoiceDetail } from '../invoices/serialize'

export class PortalService {
  constructor(
    private readonly customers = new CustomerRepository(),
    private readonly services = new ServiceRepository(),
    private readonly invoices = new InvoiceRepository(),
  ) {}

  async summary(customerId: string): Promise<ApiPortalSummary> {
    const [customer, services, invoices, balances, config] = await Promise.all([
      this.customers.findById(customerId),
      this.services.listByCustomer(customerId),
      this.invoices.listForCustomer(customerId),
      this.invoices.balanceByCurrencyForCustomer(customerId),
      useBillingConfig(),
    ])
    if (!customer) throw DomainError.notFound('Customer tidak ditemukan.')
    const today = todayIsoDate(config.timezone)

    return {
      customer: {
        id: customer.id,
        customerNumber: customer.customerNumber,
        name: customer.name,
        companyName: customer.companyName,
      },
      services,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalAmount: invoice.totalAmount.toString(),
        amountPaid: invoice.amountPaid.toString(),
        balanceDue: invoice.balanceDue.toString(),
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        customerCompanyName: invoice.customerCompanyName,
        daysPastDue: daysPastDue(invoice.dueDate, today),
      })),
      openBalance: balances.map((row) => ({ currency: row.currency, amount: row.amount })),
    }
  }

  async invoiceDetail(customerId: string, invoiceId: string) {
    const detail = await this.invoices.findDetailForCustomer(invoiceId, customerId)
    if (!detail) throw DomainError.notFound('Invoice tidak ditemukan.')
    const today = todayIsoDate((await useBillingConfig()).timezone)
    return { raw: detail, serialized: serializeInvoiceDetail(detail, today) }
  }
}
