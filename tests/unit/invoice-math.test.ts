import { describe, expect, it } from 'vitest'
import {
  computeInvoiceTotals,
  formatScaledDecimal,
  lineSubtotal,
  parseScaledDecimal,
  taxForAmount,
} from '../../server/services/billing/invoice-math'
import { addDays, billingPeriod, daysPastDue } from '../../server/services/billing/cycles'

describe('parseScaledDecimal', () => {
  it('scales whole and decimal values', () => {
    expect(parseScaledDecimal('1', 10_000n, 4)).toBe(10_000n)
    expect(parseScaledDecimal('1.5', 10_000n, 4)).toBe(15_000n)
    expect(parseScaledDecimal('0.11', 10_000n, 4)).toBe(1_100n)
  })

  it('truncates beyond the scale instead of rounding', () => {
    expect(parseScaledDecimal('0.00019', 10_000n, 4)).toBe(1n)
  })

  it('rejects malformed and negative input', () => {
    expect(() => parseScaledDecimal('', 10_000n, 4)).toThrow()
    expect(() => parseScaledDecimal('.', 10_000n, 4)).toThrow()
    expect(() => parseScaledDecimal('-1', 10_000n, 4)).toThrow()
    expect(() => parseScaledDecimal('abc', 10_000n, 4)).toThrow()
  })

  it('is exact for values beyond Number safe integer range', () => {
    // 90,071,992,547,409.9 must not lose precision.
    expect(parseScaledDecimal('90071992547409.9', 10_000n, 4)).toBe(900719925474099000n)
  })
})

describe('lineSubtotal', () => {
  it('multiplies quantity by unit price', () => {
    expect(lineSubtotal('1', 500_000n)).toBe(500_000n)
    expect(lineSubtotal('2', 500_000n)).toBe(1_000_000n)
    expect(lineSubtotal('1.5', 500_000n)).toBe(750_000n)
  })

  it('rounds half up', () => {
    // 0.3333 * 100 = 33.33 -> 33
    expect(lineSubtotal('0.3333', 100n)).toBe(33n)
    // 0.5 * 1 = 0.5 -> 1
    expect(lineSubtotal('0.5', 1n)).toBe(1n)
  })
})

describe('taxForAmount', () => {
  it('applies a numeric(7,4) fraction', () => {
    expect(taxForAmount(500_000n, '0.11')).toBe(55_000n)
    expect(taxForAmount(500_000n, '0.1')).toBe(50_000n)
  })

  it('returns zero when no rate is configured', () => {
    expect(taxForAmount(500_000n, null)).toBe(0n)
    expect(taxForAmount(500_000n, '0')).toBe(0n)
  })

  it('rounds half up on odd cents', () => {
    // 33 * 0.11 = 3.63 -> 4
    expect(taxForAmount(33n, '0.11')).toBe(4n)
  })
})

describe('computeInvoiceTotals', () => {
  it('sums subtotals and taxes across lines', () => {
    const totals = computeInvoiceTotals([
      { quantity: '1', unitPriceAmount: 500_000n, taxRate: '0.11' },
      { quantity: '2', unitPriceAmount: 100_000n, taxRate: '0.11' },
    ])

    expect(totals.subtotalAmount).toBe(700_000n)
    expect(totals.taxAmount).toBe(77_000n)
    expect(totals.totalAmount).toBe(777_000n)
  })

  it('keeps the header equal to the sum of its lines', () => {
    const totals = computeInvoiceTotals([
      { quantity: '0.3333', unitPriceAmount: 100n, taxRate: '0.11' },
      { quantity: '1', unitPriceAmount: 33n, taxRate: '0.11' },
    ])

    const lineTotal = totals.lines.reduce((sum, line) => sum + line.totalAmount, 0n)
    expect(totals.totalAmount).toBe(lineTotal)
    expect(totals.subtotalAmount).toBe(
      totals.lines.reduce((sum, line) => sum + line.subtotalAmount, 0n),
    )
  })

  it('handles an empty invoice', () => {
    const totals = computeInvoiceTotals([])
    expect(totals).toEqual({
      lines: [],
      subtotalAmount: 0n,
      discountAmount: 0n,
      discountPercent: null,
      taxAmount: 0n,
      totalAmount: 0n,
    })
  })

  it('applies a percent discount before tax', () => {
    const totals = computeInvoiceTotals(
      [{ quantity: '1', unitPriceAmount: 1_000_000n, taxRate: '0.11' }],
      { percent: '0.1' },
    )

    expect(totals.subtotalAmount).toBe(1_000_000n)
    expect(totals.discountAmount).toBe(100_000n)
    expect(totals.discountPercent).toBe('0.1')
    expect(totals.taxAmount).toBe(99_000n)
    expect(totals.totalAmount).toBe(999_000n)
  })

  it('applies a nominal discount and keeps header equal to line totals', () => {
    const totals = computeInvoiceTotals(
      [
        { quantity: '1', unitPriceAmount: 500_000n, taxRate: '0.11' },
        { quantity: '1', unitPriceAmount: 500_000n, taxRate: '0.11' },
      ],
      { amount: 100_000n },
    )

    expect(totals.discountAmount).toBe(100_000n)
    expect(totals.discountPercent).toBeNull()
    expect(totals.taxAmount).toBe(99_000n)
    expect(totals.totalAmount).toBe(999_000n)
    expect(totals.totalAmount).toBe(totals.lines.reduce((sum, line) => sum + line.totalAmount, 0n))
  })

  it('caps a discount at the invoice subtotal', () => {
    const totals = computeInvoiceTotals(
      [{ quantity: '1', unitPriceAmount: 50_000n, taxRate: '0.11' }],
      { amount: 80_000n },
    )

    expect(totals.discountAmount).toBe(50_000n)
    expect(totals.taxAmount).toBe(0n)
    expect(totals.totalAmount).toBe(0n)
  })
})

describe('formatScaledDecimal', () => {
  it('round-trips with parseScaledDecimal', () => {
    expect(formatScaledDecimal(15_000n, 10_000n, 4)).toBe('1.5000')
    expect(formatScaledDecimal(10_000n, 10_000n, 4)).toBe('1.0000')
    expect(parseScaledDecimal(formatScaledDecimal(12_345n, 10_000n, 4), 10_000n, 4)).toBe(12_345n)
  })
})

describe('billing period helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-01', 29)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('derives an inclusive monthly period billed in advance', () => {
    expect(billingPeriod('2026-09-01', 'monthly')).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    })
  })

  it('derives an inclusive annual period', () => {
    expect(billingPeriod('2026-01-01', 'annually')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    })
  })

  it('uses the billing date as the period for a one-time service', () => {
    expect(billingPeriod('2026-09-01', 'one_time')).toEqual({
      start: '2026-09-01',
      end: '2026-09-01',
    })
  })

  it('counts days past due only after the due date', () => {
    expect(daysPastDue('2026-09-29', '2026-09-29')).toBe(0)
    expect(daysPastDue('2026-09-30', '2026-09-29')).toBe(0)
    expect(daysPastDue('2026-09-01', '2026-09-29')).toBe(28)
  })
})
