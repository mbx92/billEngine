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
import {
  infrastructureDatabaseClusters,
  infrastructureOperations,
  infrastructureResources,
} from './infrastructure'
import type { DatabaseMode } from './provisioning'

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
    databaseMode: varchar('database_mode', { length: 32 })
      .$type<DatabaseMode>()
      .notNull()
      .default('none'),
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
    planDatabaseMode: varchar('plan_database_mode', { length: 32 })
      .$type<DatabaseMode>()
      .notNull()
      .default('none'),
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
    infrastructureResourceId: uuid('infrastructure_resource_id').references(
      () => infrastructureResources.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('service_resources_service_resource_uidx').on(table.serviceId, table.resourceId),
    index('service_resources_service_id_idx').on(table.serviceId),
    index('service_resources_resource_id_idx').on(table.resourceId),
    index('service_resources_infrastructure_resource_id_idx').on(table.infrastructureResourceId),
  ],
)

export type NativeServiceDatabaseStatus =
  'provisioning' | 'active' | 'failed' | 'pending_deletion' | 'deleted'

export const infrastructureServiceDatabases = pgTable(
  'infrastructure_service_databases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    databaseClusterId: uuid('database_cluster_id')
      .notNull()
      .references(() => infrastructureDatabaseClusters.id, { onDelete: 'restrict' }),
    applicationResourceId: uuid('application_resource_id')
      .notNull()
      .references(() => infrastructureResources.id, { onDelete: 'restrict' }),
    provisioningOperationId: uuid('provisioning_operation_id').references(
      () => infrastructureOperations.id,
      { onDelete: 'set null' },
    ),
    redeployOperationId: uuid('redeploy_operation_id').references(
      () => infrastructureOperations.id,
      { onDelete: 'set null' },
    ),
    databaseName: varchar('database_name', { length: 63 }).notNull(),
    roleName: varchar('role_name', { length: 63 }).notNull(),
    passwordEncrypted: text('password_encrypted').notNull(),
    connectionUriEncrypted: text('connection_uri_encrypted').notNull(),
    environmentKey: varchar('environment_key', { length: 255 }).notNull().default('DATABASE_URL'),
    status: varchar('status', { length: 32 })
      .$type<NativeServiceDatabaseStatus>()
      .notNull()
      .default('provisioning'),
    lastError: text('last_error'),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('infrastructure_service_databases_active_service_uidx')
      .on(table.serviceId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex('infrastructure_service_databases_active_application_uidx')
      .on(table.applicationResourceId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex('infrastructure_service_databases_cluster_database_uidx').on(
      table.databaseClusterId,
      table.databaseName,
    ),
    uniqueIndex('infrastructure_service_databases_cluster_role_uidx').on(
      table.databaseClusterId,
      table.roleName,
    ),
    index('infrastructure_service_databases_cluster_id_idx').on(table.databaseClusterId),
    index('infrastructure_service_databases_status_idx').on(table.status),
    check(
      'infrastructure_service_databases_status_check',
      sql`${table.status} in ('provisioning', 'active', 'failed', 'pending_deletion', 'deleted')`,
    ),
  ],
)
