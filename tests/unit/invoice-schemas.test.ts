import { describe, expect, it } from 'vitest'
import { invoiceListQuerySchema } from '../../shared/schemas/invoices'

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
