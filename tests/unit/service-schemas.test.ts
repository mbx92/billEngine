import { describe, expect, it } from 'vitest'
import { createCustomerSchema } from '../../shared/schemas/customers'
import { createPlanSchema } from '../../shared/schemas/plans'
import { createServiceSchema } from '../../shared/schemas/services'

const customerId = '11111111-1111-4111-8111-111111111111'
const resourceId = '22222222-2222-4222-8222-222222222222'
const planId = '33333333-3333-4333-8333-333333333333'

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
      planId,
      name: 'Production Hosting',
      description: '',
      billingStartDate: '2026-10-01',
      nextDueDate: '2026-10-01',
      invoiceLeadDays: '3',
      paymentDueDays: '7',
      taxRate: '0.11',
      resourceIds: [resourceId],
    })

    expect(parsed.planId).toBe(planId)
    expect(parsed.description).toBeUndefined()
    expect(parsed.invoiceLeadDays).toBe(3)
  })

  it('rejects duplicate resources and tax rates above one', () => {
    const result = createServiceSchema.safeParse({
      customerId,
      planId,
      name: 'Invalid service',
      billingStartDate: '2026-10-01',
      taxRate: '1.1',
      resourceIds: [resourceId, resourceId],
    })

    expect(result.success).toBe(false)
  })

  it('rejects a recurring due date before billing starts', () => {
    const result = createServiceSchema.safeParse({
      customerId,
      planId,
      name: 'Invalid schedule',
      billingStartDate: '2026-10-01',
      nextDueDate: '2026-09-30',
    })

    expect(result.success).toBe(false)
  })

  it('normalizes plan price and requires unique inclusions', () => {
    const parsed = createPlanSchema.parse({
      name: 'Starter',
      description: '',
      currency: 'idr',
      priceAmount: '250000',
      billingCycle: 'monthly',
      inclusions: ['1 vCPU', 'RAM 1 GB', 'Backup harian'],
    })

    expect(parsed.priceAmount).toBe(250_000n)
    expect(parsed.currency).toBe('IDR')
    expect(parsed.description).toBeUndefined()

    expect(
      createPlanSchema.safeParse({
        name: 'Duplicate',
        currency: 'IDR',
        priceAmount: '1',
        billingCycle: 'monthly',
        inclusions: ['RAM 1 GB', 'ram 1 gb'],
      }).success,
    ).toBe(false)
  })
})
