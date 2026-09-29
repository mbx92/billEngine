import { CustomerOptionRepository } from '../../repositories/customer-options'
import { ServiceRepository } from '../../repositories/services'
import type { ApiManualInvoiceOptions } from '../../../shared/types/api'

/**
 * Reference data for the manual invoice form: which customer to bill and which
 * of their services to prefill a line item from.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [customers, services] = await Promise.all([
    new CustomerOptionRepository().list(),
    new ServiceRepository().list(1, 100),
  ])

  const data: ApiManualInvoiceOptions = {
    customers,
    services: services.rows
      .filter((service) => service.status === 'active')
      .map((service) => ({
        id: service.id,
        serviceNumber: service.serviceNumber,
        name: service.name,
        customerId: service.customerId,
        currency: service.currency,
        priceAmount: service.priceAmount,
        billingCycle: service.billingCycle,
        nextDueDate: service.nextDueDate,
      })),
  }

  return {
    data,
  }
})
