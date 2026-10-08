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

export interface InvoiceDiscountInput {
  /** Rupiah discount. Ignored when `percent` is set. */
  amount?: bigint | null
  /** numeric(7,4) fraction, e.g. "0.1000" for 10%. */
  percent?: string | null
}

export interface ComputedInvoiceTotals {
  lines: ComputedInvoiceLine[]
  subtotalAmount: bigint
  discountAmount: bigint
  discountPercent: string | null
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

export function resolveDiscount(
  subtotalAmount: bigint,
  discount?: InvoiceDiscountInput | null,
): { discountAmount: bigint; discountPercent: string | null } {
  if (!discount || subtotalAmount <= 0n) {
    return { discountAmount: 0n, discountPercent: null }
  }

  if (discount.percent) {
    const rate = parseScaledDecimal(discount.percent, TAX_RATE_SCALE, 4)
    if (rate === 0n) return { discountAmount: 0n, discountPercent: null }

    const amount = divideHalfUp(subtotalAmount * rate, TAX_RATE_SCALE)
    return {
      discountAmount: amount > subtotalAmount ? subtotalAmount : amount,
      discountPercent: discount.percent,
    }
  }

  if (discount.amount && discount.amount > 0n) {
    return {
      discountAmount: discount.amount > subtotalAmount ? subtotalAmount : discount.amount,
      discountPercent: null,
    }
  }

  return { discountAmount: 0n, discountPercent: null }
}

/**
 * Splits an invoice-level discount across lines so tax can be applied on the
 * discounted taxable amount. The last line absorbs remainder so the header
 * discount always equals the sum of line discounts.
 */
export function allocateLineDiscounts(
  subtotals: readonly bigint[],
  discountAmount: bigint,
): bigint[] {
  const allocated = subtotals.map(() => 0n)
  if (discountAmount <= 0n || subtotals.length === 0) return allocated

  const total = subtotals.reduce((sum, value) => sum + value, 0n)
  if (total <= 0n) return allocated

  const target = discountAmount > total ? total : discountAmount
  let remaining = target

  for (let index = 0; index < subtotals.length; index += 1) {
    const lineSubtotalAmount = subtotals[index]!
    const isLast = index === subtotals.length - 1
    const share = isLast ? remaining : divideHalfUp(target * lineSubtotalAmount, total)
    const applied =
      share > lineSubtotalAmount
        ? lineSubtotalAmount
        : share > remaining
          ? remaining
          : share
    allocated[index] = applied
    remaining -= applied
  }

  return allocated
}

/**
 * Totals are computed per line and then summed, so the invoice header always
 * equals the sum of its items (no separate rounding path). Invoice-level
 * discount is allocated onto lines before tax.
 */
export function computeInvoiceTotals(
  lines: readonly InvoiceLine[],
  discount?: InvoiceDiscountInput | null,
): ComputedInvoiceTotals {
  const rawSubtotals = lines.map((line) => lineSubtotal(line.quantity, line.unitPriceAmount))
  const subtotalAmount = rawSubtotals.reduce((sum, value) => sum + value, 0n)
  const resolved = resolveDiscount(subtotalAmount, discount)
  const lineDiscounts = allocateLineDiscounts(rawSubtotals, resolved.discountAmount)
  const discountAmount = lineDiscounts.reduce((sum, value) => sum + value, 0n)

  const computed = lines.map<ComputedInvoiceLine>((line, index) => {
    const subtotalLineAmount = rawSubtotals[index]!
    const taxableAmount = subtotalLineAmount - lineDiscounts[index]!
    const taxAmount = taxForAmount(taxableAmount, line.taxRate)

    return {
      quantity: line.quantity,
      unitPriceAmount: line.unitPriceAmount,
      subtotalAmount: subtotalLineAmount,
      taxRate: line.taxRate,
      taxAmount,
      totalAmount: taxableAmount + taxAmount,
    }
  })

  return {
    lines: computed,
    subtotalAmount,
    discountAmount,
    discountPercent: discountAmount > 0n ? resolved.discountPercent : null,
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
