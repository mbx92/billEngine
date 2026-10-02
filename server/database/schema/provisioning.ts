import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { coolifyResources, coolifyServers, resourceDomains } from './coolify'
import { services } from './services'

export type DeploymentBuildPack =
  'nixpacks' | 'railpack' | 'static' | 'dockerfile' | 'dockercompose'

export type ProvisioningStatus =
  | 'queued'
  | 'provisioning_database'
  | 'importing_database'
  | 'creating_application'
  | 'configuring_environment'
  | 'configuring_domain'
  | 'deploying'
  | 'verifying_health'
  | 'verifying_ssl'
  | 'active'
  | 'failed'

export type ProvisioningDomainType = 'platform' | 'custom'
export type DatabaseMode = 'none' | 'shared' | 'dedicated'
export type ServiceDatabaseStatus =
  'provisioning' | 'active' | 'failed' | 'pending_deletion' | 'deleted'

export const databaseClusters = pgTable(
  'database_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    coolifyServerId: uuid('coolify_server_id')
      .notNull()
      .references(() => coolifyServers.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 160 }).notNull(),
    engine: varchar('engine', { length: 32 }).notNull().default('postgresql'),
    host: varchar('host', { length: 253 }).notNull(),
    port: integer('port').notNull().default(5432),
    adminDatabase: varchar('admin_database', { length: 63 }).notNull().default('postgres'),
    provisionerUsername: varchar('provisioner_username', { length: 63 }).notNull(),
    credentialEncrypted: text('credential_encrypted').notNull(),
    sslMode: varchar('ssl_mode', { length: 32 }).notNull().default('prefer'),
    defaultConnectionLimit: integer('default_connection_limit').notNull().default(20),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('database_clusters_name_uidx').on(table.name),
    index('database_clusters_server_id_idx').on(table.coolifyServerId),
    index('database_clusters_active_idx').on(table.isActive),
  ],
)

export const deploymentBlueprints = pgTable(
  'deployment_blueprints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    coolifyServerId: uuid('coolify_server_id')
      .notNull()
      .references(() => coolifyServers.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    repositoryUrl: text('repository_url').notNull(),
    branch: varchar('branch', { length: 255 }).notNull().default('main'),
    buildPack: varchar('build_pack', { length: 32 }).$type<DeploymentBuildPack>().notNull(),
    projectUuid: varchar('project_uuid', { length: 160 }).notNull(),
    targetServerUuid: varchar('target_server_uuid', { length: 160 }).notNull(),
    environmentName: varchar('environment_name', { length: 160 }).notNull().default('production'),
    destinationUuid: varchar('destination_uuid', { length: 160 }),
    baseDirectory: text('base_directory'),
    dockerfileLocation: text('dockerfile_location'),
    dockerComposeLocation: text('docker_compose_location'),
    composeServiceName: varchar('compose_service_name', { length: 160 }),
    portsExposes: varchar('ports_exposes', { length: 255 }),
    healthcheckPath: text('healthcheck_path'),
    healthcheckPort: varchar('healthcheck_port', { length: 32 }),
    environmentKeys: jsonb('environment_keys').$type<string[]>().notNull().default([]),
    customLabels: text('custom_labels'),
    billingGateEnabled: boolean('billing_gate_enabled').notNull().default(false),
    databaseClusterId: uuid('database_cluster_id').references(() => databaseClusters.id, {
      onDelete: 'restrict',
    }),
    databaseEnvironmentKey: varchar('database_environment_key', { length: 255 })
      .notNull()
      .default('DATABASE_URL'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('deployment_blueprints_slug_uidx').on(table.slug),
    index('deployment_blueprints_server_id_idx').on(table.coolifyServerId),
    index('deployment_blueprints_active_idx').on(table.isActive),
  ],
)

export const provisioningJobs = pgTable(
  'provisioning_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    blueprintId: uuid('blueprint_id')
      .notNull()
      .references(() => deploymentBlueprints.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 40 })
      .$type<ProvisioningStatus>()
      .notNull()
      .default('queued'),
    failedStage: varchar('failed_stage', { length: 40 }).$type<ProvisioningStatus>(),
    applicationName: varchar('application_name', { length: 255 }).notNull(),
    hostname: varchar('hostname', { length: 253 }),
    domainType: varchar('domain_type', { length: 32 }).$type<ProvisioningDomainType>(),
    environmentEncrypted: text('environment_encrypted'),
    sqlImportEncrypted: text('sql_import_encrypted'),
    sqlImportFilename: varchar('sql_import_filename', { length: 255 }),
    sqlImportSize: integer('sql_import_size'),
    sqlImportChecksum: varchar('sql_import_checksum', { length: 64 }),
    serviceDatabaseId: uuid('service_database_id').references(
      (): AnyPgColumn => serviceDatabases.id,
      { onDelete: 'set null' },
    ),
    coolifyApplicationUuid: varchar('coolify_application_uuid', { length: 160 }),
    coolifyDeploymentUuid: varchar('coolify_deployment_uuid', { length: 160 }),
    resourceId: uuid('resource_id').references(() => coolifyResources.id, {
      onDelete: 'set null',
    }),
    domainId: uuid('domain_id').references(() => resourceDomains.id, { onDelete: 'set null' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
    stageStartedAt: timestamp('stage_started_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('provisioning_jobs_status_run_idx').on(table.status, table.nextRunAt),
    index('provisioning_jobs_service_id_idx').on(table.serviceId),
    index('provisioning_jobs_blueprint_id_idx').on(table.blueprintId),
    uniqueIndex('provisioning_jobs_application_uuid_uidx')
      .on(table.coolifyApplicationUuid)
      .where(sql`${table.coolifyApplicationUuid} is not null`),
  ],
)

export const serviceDatabases = pgTable(
  'service_databases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    databaseClusterId: uuid('database_cluster_id')
      .notNull()
      .references(() => databaseClusters.id, { onDelete: 'restrict' }),
    provisioningJobId: uuid('provisioning_job_id').references(() => provisioningJobs.id, {
      onDelete: 'set null',
    }),
    databaseName: varchar('database_name', { length: 63 }).notNull(),
    roleName: varchar('role_name', { length: 63 }).notNull(),
    passwordEncrypted: text('password_encrypted').notNull(),
    status: varchar('status', { length: 32 })
      .$type<ServiceDatabaseStatus>()
      .notNull()
      .default('provisioning'),
    lastError: text('last_error'),
    sqlImportedAt: timestamp('sql_imported_at', { withTimezone: true }),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('service_databases_active_service_uidx')
      .on(table.serviceId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex('service_databases_cluster_database_uidx').on(
      table.databaseClusterId,
      table.databaseName,
    ),
    uniqueIndex('service_databases_cluster_role_uidx').on(table.databaseClusterId, table.roleName),
    index('service_databases_cluster_id_idx').on(table.databaseClusterId),
    index('service_databases_status_idx').on(table.status),
  ],
)

export const provisioningJobEvents = pgTable(
  'provisioning_job_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => provisioningJobs.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 40 }).$type<ProvisioningStatus>().notNull(),
    level: varchar('level', { length: 16 }).notNull().default('info'),
    message: text('message').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('provisioning_job_events_job_created_idx').on(table.jobId, table.createdAt)],
)
