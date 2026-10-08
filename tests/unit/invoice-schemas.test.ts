import { describe, expect, it } from 'vitest'
import {
  createInvoiceSchema,
  createCreditNoteSchema,
  invoiceListQuerySchema,
  paymentListQuerySchema,
  updateInvoiceSchema,
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

  it('accepts a percent or amount discount, but not both', () => {
    const base = {
      customerId,
      issueDate: '2026-09-30',
      dueDate: '2026-10-07',
      items: [{ description: 'Managed hosting', quantity: '1', unitPriceAmount: '500000' }],
    }

    expect(createInvoiceSchema.parse({ ...base, discountPercent: '0.1' }).discountPercent).toBe(
      '0.1',
    )
    expect(createInvoiceSchema.parse({ ...base, discountAmount: '50000' }).discountAmount).toBe(
      50_000n,
    )
    expect(
      createInvoiceSchema.safeParse({
        ...base,
        discountAmount: '50000',
        discountPercent: '0.1',
      }).success,
    ).toBe(false)
  })
})

describe('update invoice schema', () => {
  it('reuses the same writable invoice rules', () => {
    const parsed = updateInvoiceSchema.parse({
      customerId,
      issueDate: '2026-09-30',
      dueDate: '2026-10-07',
      notes: '',
      items: [{ description: 'Update fee', quantity: '1', unitPriceAmount: '250000' }],
    })

    expect(parsed.notes).toBeUndefined()
    expect(parsed.items[0]?.unitPriceAmount).toBe(250_000n)
  })
})

describe('credit note schema', () => {
  it('coerces a positive credit amount and requires a reason', () => {
    expect(createCreditNoteSchema.parse({ amount: '125000', reason: 'Service adjustment' })).toEqual(
      { amount: 125_000n, reason: 'Service adjustment' },
    )
    expect(createCreditNoteSchema.safeParse({ amount: '0', reason: 'No credit' }).success).toBe(
      false,
    )
  })
})
