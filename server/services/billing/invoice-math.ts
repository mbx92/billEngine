import type { InvoiceStatus } from '../../../shared/constants/domain'

/**
 * Deterministic invoice math. Everything stays in BigInt (integer rupiah, see
 * docs §18) so no rounding drift is ever introduced by floating point.
 *
 * `tax_rate` is a PostgreSQL numeric(7,4) fraction: 0.1100 means 11%.
 * `quantity` is a PostgreSQL numeric(14,4).
 */

const QUANTITY_SCALE = 10_000n
const TAX_RATE_SCALE = 10_000n

export interface InvoiceLine {
  quantity: string
  unitPriceAmount: bigint
  taxRate: string | null
}

export interface ComputedInvoiceLine {
  quantity: string
  unitPriceAmount: bigint
  subtotalAmount: bigint
  taxRate: string | null
  taxAmount: bigint
  totalAmount: bigint
}

export interface ComputedInvoiceTotals {
  lines: ComputedInvoiceLine[]
  subtotalAmount: bigint
  taxAmount: bigint
  totalAmount: bigint
}

/** Half-up rounding for non-negative values. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive.')
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/**
 * Converts a non-negative decimal string into an integer scaled by `scale`,
 * e.g. parseScaledDecimal('1.5', 10_000n) === 15000n. Avoids Number() so values
 * stay exact, and rejects malformed input instead of guessing.
 */
export function parseScaledDecimal(value: string, scale: bigint, decimals: number): bigint {
  const trimmed = value.trim()
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`Invalid non-negative decimal: ${value}`)
  }

  const [whole = '0', fraction = ''] = trimmed.split('.')

  return (
    BigInt(whole || '0') * scale + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0')
  )
}

/** Quantity formats the result back to a PostgreSQL numeric(14,4) string. */
export function formatScaledDecimal(value: bigint, scale: bigint, decimals: number): string {
  const whole = value / scale
  const fraction = (value % scale).toString().padStart(decimals, '0')
  return decimals === 0 ? whole.toString() : `${whole}.${fraction}`
}

export function lineSubtotal(quantity: string, unitPriceAmount: bigint): bigint {
  const scaledQuantity = parseScaledDecimal(quantity, QUANTITY_SCALE, 4)
  return divideHalfUp(scaledQuantity * unitPriceAmount, QUANTITY_SCALE)
}

export function taxForAmount(subtotalAmount: bigint, taxRate: string | null): bigint {
  if (!taxRate) return 0n

  const rate = parseScaledDecimal(taxRate, TAX_RATE_SCALE, 4)
  if (rate === 0n) return 0n

  return divideHalfUp(subtotalAmount * rate, TAX_RATE_SCALE)
}

/**
 * Totals are computed per line and then summed, so the invoice header always
 * equals the sum of its items (no separate rounding path).
 */
export function computeInvoiceTotals(lines: readonly InvoiceLine[]): ComputedInvoiceTotals {
  const computed = lines.map<ComputedInvoiceLine>((line) => {
    const subtotalAmount = lineSubtotal(line.quantity, line.unitPriceAmount)
    const taxAmount = taxForAmount(subtotalAmount, line.taxRate)

    return {
      quantity: line.quantity,
      unitPriceAmount: line.unitPriceAmount,
      subtotalAmount,
      taxRate: line.taxRate,
      taxAmount,
      totalAmount: subtotalAmount + taxAmount,
    }
  })

  return {
    lines: computed,
    subtotalAmount: computed.reduce((sum, line) => sum + line.subtotalAmount, 0n),
    taxAmount: computed.reduce((sum, line) => sum + line.taxAmount, 0n),
    totalAmount: computed.reduce((sum, line) => sum + line.totalAmount, 0n),
  }
}

/**
 * Monthly recurring revenue lives in `overview.ts` (`monthlyRecurringAmount`)
 * so the dashboard and the billing engine cannot drift apart.
 */
export function invoiceIsPayable(status: InvoiceStatus): boolean {
  return status === 'unpaid' || status === 'overdue'
}
