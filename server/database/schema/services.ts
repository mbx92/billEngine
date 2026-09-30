import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { coolifyResources } from './coolify'
import { customers } from './customers'
import { billingCycle, serviceStatus } from './enums'

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    priceAmount: bigint('price_amount', { mode: 'bigint' }).notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    inclusions: jsonb('inclusions').$type<string[]>().notNull().default([]),
    includedResourceCount: integer('included_resource_count'),
    includedCpuCores: numeric('included_cpu_cores', { precision: 10, scale: 3 }),
    includedMemoryBytes: bigint('included_memory_bytes', { mode: 'bigint' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('plans_name_uidx').on(table.name),
    index('plans_active_idx').on(table.isActive),
    check('plans_price_amount_check', sql`${table.priceAmount} >= 0`),
    check(
      'plans_resource_count_check',
      sql`${table.includedResourceCount} is null or ${table.includedResourceCount} > 0`,
    ),
    check(
      'plans_cpu_cores_check',
      sql`${table.includedCpuCores} is null or ${table.includedCpuCores} > 0`,
    ),
    check(
      'plans_memory_bytes_check',
      sql`${table.includedMemoryBytes} is null or ${table.includedMemoryBytes} > 0`,
    ),
  ],
)

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'restrict' }),
    planName: varchar('plan_name', { length: 160 }),
    planInclusions: jsonb('plan_inclusions').$type<string[]>().notNull().default([]),
    serviceNumber: varchar('service_number', { length: 32 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    status: serviceStatus('status').notNull().default('active'),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    priceAmount: bigint('price_amount', { mode: 'bigint' }).notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    planResourceCount: integer('plan_resource_count'),
    planCpuCores: numeric('plan_cpu_cores', { precision: 10, scale: 3 }),
    planMemoryBytes: bigint('plan_memory_bytes', { mode: 'bigint' }),
    billingStartDate: date('billing_start_date').notNull(),
    nextDueDate: date('next_due_date'),
    invoiceLeadDays: integer('invoice_lead_days').notNull().default(0),
    paymentDueDays: integer('payment_due_days').notNull().default(7),
    taxRate: numeric('tax_rate', { precision: 7, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
  },
  (table) => [
    uniqueIndex('services_service_number_uidx').on(table.serviceNumber),
    index('services_customer_id_idx').on(table.customerId),
    index('services_plan_id_idx').on(table.planId),
    index('services_status_idx').on(table.status),
    index('services_next_due_date_idx').on(table.nextDueDate),
    index('services_customer_status_idx').on(table.customerId, table.status),
    check('services_price_amount_check', sql`${table.priceAmount} >= 0`),
    check('services_due_days_check', sql`${table.paymentDueDays} >= 0`),
    check(
      'services_plan_resource_count_check',
      sql`${table.planResourceCount} is null or ${table.planResourceCount} > 0`,
    ),
    check(
      'services_plan_cpu_cores_check',
      sql`${table.planCpuCores} is null or ${table.planCpuCores} > 0`,
    ),
    check(
      'services_plan_memory_bytes_check',
      sql`${table.planMemoryBytes} is null or ${table.planMemoryBytes} > 0`,
    ),
  ],
)

export const serviceResources = pgTable(
  'service_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => coolifyResources.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('service_resources_service_resource_uidx').on(table.serviceId, table.resourceId),
    index('service_resources_service_id_idx').on(table.serviceId),
    index('service_resources_resource_id_idx').on(table.resourceId),
  ],
)
