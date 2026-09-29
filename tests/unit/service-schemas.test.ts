import { describe, expect, it } from 'vitest'
import { createCustomerSchema } from '../../shared/schemas/customers'
import { createServiceSchema } from '../../shared/schemas/services'

const customerId = '11111111-1111-4111-8111-111111111111'
const resourceId = '22222222-2222-4222-8222-222222222222'

describe('customer and service schemas', () => {
  it('normalizes empty optional customer fields', () => {
    const parsed = createCustomerSchema.parse({
      name: 'Acme Billing',
      companyName: '',
      email: 'billing@example.test',
      phone: '   ',
      countryCode: 'id',
    })

    expect(parsed.companyName).toBeUndefined()
    expect(parsed.phone).toBeUndefined()
    expect(parsed.countryCode).toBe('ID')
  })

  it('coerces form values for a recurring service', () => {
    const parsed = createServiceSchema.parse({
      customerId,
      name: 'Production Hosting',
      description: '',
      currency: 'idr',
      priceAmount: '500000',
      billingCycle: 'monthly',
      billingStartDate: '2026-10-01',
      nextDueDate: '2026-10-01',
      invoiceLeadDays: '3',
      paymentDueDays: '7',
      taxRate: '0.11',
      resourceIds: [resourceId],
    })

    expect(parsed.priceAmount).toBe(500_000n)
    expect(parsed.currency).toBe('IDR')
    expect(parsed.description).toBeUndefined()
    expect(parsed.invoiceLeadDays).toBe(3)
  })

  it('rejects duplicate resources and tax rates above one', () => {
    const result = createServiceSchema.safeParse({
      customerId,
      name: 'Invalid service',
      priceAmount: '1000',
      billingCycle: 'monthly',
      billingStartDate: '2026-10-01',
      taxRate: '1.1',
      resourceIds: [resourceId, resourceId],
    })

    expect(result.success).toBe(false)
  })

  it('rejects a recurring due date before billing starts', () => {
    const result = createServiceSchema.safeParse({
      customerId,
      name: 'Invalid schedule',
      priceAmount: '1000',
      billingCycle: 'monthly',
      billingStartDate: '2026-10-01',
      nextDueDate: '2026-09-30',
    })

    expect(result.success).toBe(false)
  })
})
