export const USER_ROLES = ['super_admin', 'admin', 'customer'] as const
export const CUSTOMER_STATUSES = ['active', 'inactive'] as const
export const SERVICE_STATUSES = ['active', 'suspended', 'cancelled'] as const
export const BILLING_CYCLES = [
  'one_time',
  'monthly',
  'quarterly',
  'semi_annually',
  'annually',
] as const
export const RESOURCE_CLASSIFICATIONS = ['billable', 'internal', 'ignored'] as const
export const RESOURCE_STATUSES = [
  'running',
  'stopped',
  'restarting',
  'degraded',
  'unknown',
] as const
export const INVOICE_STATUSES = ['draft', 'unpaid', 'paid', 'overdue', 'cancelled'] as const
export const PAYMENT_STATUSES = ['pending', 'completed', 'failed', 'refunded', 'cancelled'] as const
export const CREDIT_NOTE_STATUSES = ['issued', 'voided'] as const

export type UserRole = (typeof USER_ROLES)[number]
export type BillingCycle = (typeof BILLING_CYCLES)[number]
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number]
export type ResourceClassification = (typeof RESOURCE_CLASSIFICATIONS)[number]
export type ServiceStatus = (typeof SERVICE_STATUSES)[number]
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number]
