import type { InvoiceStatus, PaymentStatus } from '../../../shared/constants/domain'

export type PayableInvoiceStatus = 'unpaid' | 'paid' | 'overdue'

export interface InvoicePaymentState {
  amountPaid: bigint
  balanceDue: bigint
  status: PayableInvoiceStatus
}

/** Maps a net amount to the derived invoice payment state. */
export function invoiceStateFromNet(
  totalAmount: bigint,
  netPaid: bigint,
  isPastDue: boolean,
): InvoicePaymentState {
  const amountPaid = netPaid > 0n ? netPaid : 0n
  const balanceDue = totalAmount > amountPaid ? totalAmount - amountPaid : 0n

  return {
    amountPaid,
    balanceDue,
    status: balanceDue === 0n ? 'paid' : isPastDue ? 'overdue' : 'unpaid',
  }
}

/**
 * Invoice status is derived purely from the invoice total and its captured
 * payments, never from a payment provider (docs §12).
 */
export function invoicePaymentState(
  totalAmount: bigint,
  completedPayments: readonly bigint[],
  isPastDue: boolean,
): InvoicePaymentState {
  return invoiceStateFromNet(
    totalAmount,
    completedPayments.reduce((sum, amount) => sum + amount, 0n),
    isPastDue,
  )
}

export interface PaymentEffectRow {
  amount: bigint
  status: PaymentStatus
}

/**
 * Refunds are recorded as their own rows, so money that was captured and later
 * refunded stops counting toward the invoice balance.
 */
export function summarizePaymentEffect(rows: readonly PaymentEffectRow[]): {
  captured: bigint
  refunded: bigint
  net: bigint
} {
  let captured = 0n
  let refunded = 0n

  for (const row of rows) {
    if (row.status === 'completed') captured += row.amount
    else if (row.status === 'refunded') refunded += row.amount
  }

  return { captured, refunded, net: captured - refunded }
}

export function isInvoiceMutable(status: InvoiceStatus): boolean {
  return status === 'draft' || status === 'unpaid' || status === 'overdue'
}
