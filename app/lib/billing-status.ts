import type { InvoiceStatus, PaymentStatus } from '#shared/constants/domain'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const INVOICE_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  unpaid: 'Unpaid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

const INVOICE_TONES: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  unpaid: 'info',
  paid: 'success',
  overdue: 'warning',
  cancelled: 'danger',
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  failed: 'Failed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}

const PAYMENT_TONES: Record<PaymentStatus, Tone> = {
  pending: 'warning',
  completed: 'success',
  failed: 'danger',
  refunded: 'info',
  cancelled: 'neutral',
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_LABELS[status] ?? status
}

export function invoiceStatusTone(status: InvoiceStatus): Tone {
  return INVOICE_TONES[status] ?? 'neutral'
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_LABELS[status] ?? status
}

export function paymentStatusTone(status: PaymentStatus): Tone {
  return PAYMENT_TONES[status] ?? 'neutral'
}

export const PAYMENT_METHODS = [
  'Transfer Bank',
  'Virtual Account',
  'QRIS',
  'Tunai',
  'Lainnya',
] as const
