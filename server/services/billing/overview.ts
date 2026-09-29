import type { BillingCycle, InvoiceStatus, ServiceStatus } from '../../../shared/constants/domain'

export interface InvoiceBalanceRow {
  status: InvoiceStatus
  balanceDue: bigint
  dueDate: string
}

export interface InvoiceBalanceSummary {
  open: number
  overdue: number
  unpaidBalance: bigint
}

/**
 * Open invoices are the issued but unpaid ones (unpaid + overdue). Draft and
 * cancelled invoices are excluded so the balance matches what customers owe.
 */
export function summarizeInvoiceBalances(
  rows: readonly InvoiceBalanceRow[],
  today: string,
): InvoiceBalanceSummary {
  const open = rows.filter((row) => row.status === 'unpaid' || row.status === 'overdue')

  return {
    open: open.length,
    overdue: open.filter((row) => row.status === 'overdue' || row.dueDate < today).length,
    unpaidBalance: open.reduce((sum, row) => sum + row.balanceDue, 0n),
  }
}

/**
 * Normalizes a recurring price to an amount per calendar month using integer
 * division, so the dashboard value never depends on floating point math.
 */
export function monthlyRecurringAmount(priceAmount: bigint, billingCycle: BillingCycle): bigint {
  switch (billingCycle) {
    case 'monthly':
      return priceAmount
    case 'quarterly':
      return priceAmount / 3n
    case 'semi_annually':
      return priceAmount / 6n
    case 'annually':
      return priceAmount / 12n
    case 'one_time':
      return 0n
  }
}

export function isActiveService(status: ServiceStatus): boolean {
  return status === 'active'
}
