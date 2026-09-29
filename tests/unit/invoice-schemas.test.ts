import { describe, expect, it } from 'vitest'
import {
  createInvoiceSchema,
  invoiceListQuerySchema,
  paymentListQuerySchema,
} from '../../shared/schemas/invoices'

const customerId = '11111111-1111-4111-8111-111111111111'

describe('invoice list query', () => {
  it('accepts empty UI filters as no filter', () => {
    expect(
      invoiceListQuerySchema.parse({ page: '1', perPage: '25', status: '', query: '' }),
    ).toEqual({ page: 1, perPage: 25 })
  })

  it('accepts a valid invoice status and search term', () => {
    expect(
      invoiceListQuerySchema.parse({
        page: '2',
        perPage: '25',
        status: 'overdue',
        query: 'INV-2026',
      }),
    ).toMatchObject({ status: 'overdue', query: 'INV-2026' })
  })
})

describe('payment list query', () => {
  it('accepts empty UI filters as no filter', () => {
    expect(
      paymentListQuerySchema.parse({
        page: '1',
        perPage: '25',
        invoiceId: '',
        status: '',
        from: '',
        to: '',
      }),
    ).toEqual({ page: 1, perPage: 25 })
  })

  it('accepts status and inclusive date filters', () => {
    expect(
      paymentListQuerySchema.parse({
        status: 'completed',
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    ).toMatchObject({ status: 'completed', from: '2026-09-01', to: '2026-09-30' })
  })
})

describe('manual invoice schema', () => {
  it('coerces manual invoice amounts and accepts valid periods', () => {
    const parsed = createInvoiceSchema.parse({
      customerId,
      issueDate: '2026-09-30',
      dueDate: '2026-10-07',
      items: [
        {
          description: 'Managed hosting',
          quantity: '1',
          unitPriceAmount: '500000',
          taxRate: '0.11',
          servicePeriodStart: '2026-10-01',
          servicePeriodEnd: '2026-10-31',
        },
      ],
    })

    expect(parsed.items[0]?.unitPriceAmount).toBe(500_000n)
  })

  it('rejects reversed dates and tax rates above one', () => {
    const result = createInvoiceSchema.safeParse({
      customerId,
      issueDate: '2026-10-02',
      dueDate: '2026-10-01',
      items: [
        {
          description: 'Invalid item',
          quantity: '1',
          unitPriceAmount: '1000',
          taxRate: '11',
          servicePeriodStart: '2026-10-31',
          servicePeriodEnd: '2026-10-01',
        },
      ],
    })

    expect(result.success).toBe(false)
  })
})
