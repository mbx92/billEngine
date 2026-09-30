import { describe, expect, it } from 'vitest'
import { createCustomerSchema } from '../../shared/schemas/customers'
import { createPlanSchema, updatePlanSchema } from '../../shared/schemas/plans'
import {
  applyInfrastructureSchema,
  createServiceSchema,
  transitionServiceSchema,
  updateServiceSchema,
} from '../../shared/schemas/services'

const customerId = '11111111-1111-4111-8111-111111111111'
const resourceId = '22222222-2222-4222-8222-222222222222'
const planId = '33333333-3333-4333-8333-333333333333'

describe('customer and service schemas', () => {
  it('requires a preview fingerprint before applying infrastructure', () => {
    expect(
      applyInfrastructureSchema.parse({ fingerprint: 'a'.repeat(64), restartRunning: true }),
    ).toEqual({ fingerprint: 'a'.repeat(64), restartRunning: true })
    expect(() => applyInfrastructureSchema.parse({ fingerprint: 'stale' })).toThrow()
  })

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

  it('validates service updates and requires lifecycle reasons', () => {
    expect(
      updateServiceSchema.parse({ planId, paymentDueDays: '14', resourceIds: [resourceId] }),
    ).toMatchObject({ planId, paymentDueDays: 14 })
    expect(updateServiceSchema.safeParse({}).success).toBe(false)
    expect(transitionServiceSchema.safeParse({ status: 'suspended', reason: '' }).success).toBe(
      false,
    )

    expect(updateServiceSchema.parse({ description: '', taxRate: '' })).toEqual({
      description: null,
      taxRate: null,
    })
  })

  it('normalizes plan price and requires unique inclusions', () => {
    const parsed = createPlanSchema.parse({
      name: 'Starter',
      description: '',
      currency: 'idr',
      priceAmount: '250000',
      billingCycle: 'monthly',
      includedResourceCount: '2',
      includedCpuCores: '1.5',
      includedMemoryBytes: '2147483648',
      inclusions: ['1 vCPU', 'RAM 1 GB', 'Backup harian'],
    })

    expect(parsed.priceAmount).toBe(250_000n)
    expect(parsed.currency).toBe('IDR')
    expect(parsed.description).toBeUndefined()
    expect(parsed.includedResourceCount).toBe(2)
    expect(parsed.includedCpuCores).toBe('1.5')
    expect(parsed.includedMemoryBytes).toBe(2_147_483_648n)

    const edited = createPlanSchema.parse({
      name: 'Starter numeric input',
      currency: 'IDR',
      priceAmount: 250_000,
      billingCycle: 'monthly',
      includedResourceCount: 2,
      includedCpuCores: 1.5,
      includedMemoryBytes: 2_147_483_648,
      inclusions: ['Managed infrastructure'],
    })
    expect(edited.includedCpuCores).toBe('1.5')
    expect(
      createPlanSchema.parse({
        name: 'Free Trial',
        currency: 'IDR',
        priceAmount: 0,
        billingCycle: 'one_time',
        inclusions: ['1 CPU core', '1 GB RAM'],
      }).priceAmount,
    ).toBe(0n)
    expect(
      createPlanSchema.safeParse({
        name: 'Missing price',
        currency: 'IDR',
        priceAmount: '',
        billingCycle: 'one_time',
        inclusions: ['Trial'],
      }).success,
    ).toBe(false)
    expect(
      updatePlanSchema.parse({
        includedResourceCount: null,
        includedCpuCores: 2,
        includedMemoryBytes: null,
      }),
    ).toEqual({
      includedResourceCount: null,
      includedCpuCores: '2',
      includedMemoryBytes: null,
    })

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
