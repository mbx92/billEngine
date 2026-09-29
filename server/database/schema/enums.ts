import { pgEnum } from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', ['super_admin', 'admin', 'customer'])
export const customerStatus = pgEnum('customer_status', ['active', 'inactive'])
export const serviceStatus = pgEnum('service_status', ['active', 'suspended', 'cancelled'])
export const billingCycle = pgEnum('billing_cycle', [
  'one_time',
  'monthly',
  'quarterly',
  'semi_annually',
  'annually',
])
export const resourceClassification = pgEnum('resource_classification', [
  'billable',
  'internal',
  'ignored',
])
export const resourceStatus = pgEnum('resource_status', [
  'running',
  'stopped',
  'restarting',
  'degraded',
  'unknown',
])
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'unpaid',
  'paid',
  'overdue',
  'cancelled',
])
export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'completed',
  'failed',
  'refunded',
  'cancelled',
])
export const jobStatus = pgEnum('job_status', ['running', 'completed', 'failed'])
