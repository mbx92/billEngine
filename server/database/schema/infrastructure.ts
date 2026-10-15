import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
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
import { customers } from './customers'
import { resourceClassification } from './enums'

export const NODE_STATUSES = [
  'enrolling',
  'online',
  'degraded',
  'offline',
  'revoked',
  'unknown',
] as const
export type InfrastructureNodeStatus = (typeof NODE_STATUSES)[number]

export const RESOURCE_KINDS = ['application', 'database', 'volume'] as const
export type InfrastructureResourceKind = (typeof RESOURCE_KINDS)[number]

export const RESOURCE_STATES = [
  'pending',
  'running',
  'stopped',
  'restarting',
  'degraded',
  'deleting',
  'deleted',
  'failed',
  'unknown',
] as const
export type InfrastructureResourceState = (typeof RESOURCE_STATES)[number]

export const OPERATION_STATUSES = [
  'queued',
  'dispatched',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const
export type InfrastructureOperationStatus = (typeof OPERATION_STATUSES)[number]

export const DATABASE_CLUSTER_STATUSES = [
  'validating',
  'active',
  'degraded',
  'offline',
  'maintenance',
  'retired',
] as const
export type InfrastructureDatabaseClusterStatus = (typeof DATABASE_CLUSTER_STATUSES)[number]

export const ROUTE_STATUSES = ['pending', 'configuring', 'active', 'failed', 'disabled'] as const
export type InfrastructureRouteStatus = (typeof ROUTE_STATUSES)[number]

export const VOLUME_KINDS = ['ephemeral', 'persistent'] as const
export type InfrastructureVolumeKind = (typeof VOLUME_KINDS)[number]

export interface NodeCapacity {
  cpuMilli: number
  memoryBytes: string
  diskBytes: string
}

export interface InfrastructureLabels {
  [key: string]: string
}

export const infrastructureTemplates = pgTable(
  'infrastructure_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 32 }).notNull(),
    version: integer('version').notNull().default(1),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('infrastructure_templates_slug_uidx').on(table.slug),
    index('infrastructure_templates_active_category_idx').on(table.isActive, table.category),
    check(
      'infrastructure_templates_category_check',
      sql`${table.category} in ('application', 'database', 'cache')`,
    ),
    check('infrastructure_templates_version_check', sql`${table.version} > 0`),
  ],
)

export const infrastructureNodes = pgTable(
  'infrastructure_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    environment: varchar('environment', { length: 64 }).notNull().default('staging'),
    status: varchar('status', { length: 24 })
      .$type<InfrastructureNodeStatus>()
      .notNull()
      .default('enrolling'),
    isActive: boolean('is_active').notNull().default(true),
    isDraining: boolean('is_draining').notNull().default(false),
    agentVersion: varchar('agent_version', { length: 64 }),
    protocolVersion: varchar('protocol_version', { length: 32 }),
    osRelease: varchar('os_release', { length: 160 }),
    architecture: varchar('architecture', { length: 32 }),
    dockerVersion: varchar('docker_version', { length: 64 }),
    composeVersion: varchar('compose_version', { length: 64 }),
    capacityCpuMilli: integer('capacity_cpu_milli'),
    capacityMemoryBytes: bigint('capacity_memory_bytes', { mode: 'bigint' }),
    capacityDiskBytes: bigint('capacity_disk_bytes', { mode: 'bigint' }),
    labels: jsonb('labels').$type<InfrastructureLabels>().notNull().default({}),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    lastInventoryAt: timestamp('last_inventory_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('infrastructure_nodes_name_environment_uidx').on(table.name, table.environment),
    index('infrastructure_nodes_status_idx').on(table.status),
    index('infrastructure_nodes_heartbeat_idx').on(table.lastHeartbeatAt),
    check(
      'infrastructure_nodes_status_check',
      sql`${table.status} in ('enrolling', 'online', 'degraded', 'offline', 'revoked', 'unknown')`,
    ),
    check(
      'infrastructure_nodes_capacity_check',
      sql`(${table.capacityCpuMilli} is null or ${table.capacityCpuMilli} > 0)
        and (${table.capacityMemoryBytes} is null or ${table.capacityMemoryBytes} > 0)
        and (${table.capacityDiskBytes} is null or ${table.capacityDiskBytes} > 0)`,
    ),
  ],
)

export const nodeEnrollments = pgTable(
  'node_enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nodeName: varchar('node_name', { length: 160 }).notNull(),
    environment: varchar('environment', { length: 64 }).notNull().default('staging'),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    labels: jsonb('labels').$type<InfrastructureLabels>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('node_enrollments_token_hash_uidx').on(table.tokenHash),
    index('node_enrollments_expires_at_idx').on(table.expiresAt),
  ],
)

export const nodeIdentities = pgTable(
  'node_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => infrastructureNodes.id, { onDelete: 'cascade' }),
    credentialHash: varchar('credential_hash', { length: 128 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 160 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('node_identities_credential_hash_uidx').on(table.credentialHash),
    uniqueIndex('node_identities_fingerprint_uidx').on(table.fingerprint),
    index('node_identities_node_id_idx').on(table.nodeId),
  ],
)

export const infrastructureResources = pgTable(
  'infrastructure_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => infrastructureNodes.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id').references(() => infrastructureTemplates.id, {
      onDelete: 'set null',
    }),
    templateVersion: integer('template_version'),
    externalId: varchar('external_id', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 32 }).$type<InfrastructureResourceKind>().notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    classification: resourceClassification('classification').notNull().default('billable'),
    desiredState: varchar('desired_state', { length: 24 })
      .$type<InfrastructureResourceState>()
      .notNull()
      .default('pending'),
    observedState: varchar('observed_state', { length: 24 })
      .$type<InfrastructureResourceState>()
      .notNull()
      .default('unknown'),
    desiredRevision: integer('desired_revision').notNull().default(1),
    observedRevision: integer('observed_revision').notNull().default(0),
    imageReference: text('image_reference'),
    imageDigest: varchar('image_digest', { length: 255 }),
    desiredSpec: jsonb('desired_spec').$type<Record<string, unknown>>().notNull().default({}),
    observedSpec: jsonb('observed_spec').$type<Record<string, unknown>>(),
    labels: jsonb('labels').$type<InfrastructureLabels>().notNull().default({}),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('infrastructure_resources_node_external_uidx').on(table.nodeId, table.externalId),
    index('infrastructure_resources_node_id_idx').on(table.nodeId),
    index('infrastructure_resources_customer_id_idx').on(table.customerId),
    index('infrastructure_resources_template_id_idx').on(table.templateId),
    index('infrastructure_resources_kind_idx').on(table.kind),
    index('infrastructure_resources_observed_state_idx').on(table.observedState),
    index('infrastructure_resources_last_observed_idx').on(table.lastObservedAt),
    check(
      'infrastructure_resources_kind_check',
      sql`${table.kind} in ('application', 'database', 'volume')`,
    ),
    check(
      'infrastructure_resources_desired_state_check',
      sql`${table.desiredState} in ('pending', 'running', 'stopped', 'restarting', 'degraded', 'deleting', 'deleted', 'failed', 'unknown')`,
    ),
    check(
      'infrastructure_resources_observed_state_check',
      sql`${table.observedState} in ('pending', 'running', 'stopped', 'restarting', 'degraded', 'deleting', 'deleted', 'failed', 'unknown')`,
    ),
    check(
      'infrastructure_resources_revision_check',
      sql`${table.desiredRevision} > 0 and ${table.observedRevision} >= 0`,
    ),
  ],
)

export const infrastructureOperations = pgTable(
  'infrastructure_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => infrastructureNodes.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id').references(() => infrastructureResources.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    correlationId: uuid('correlation_id').notNull().defaultRandom(),
    action: varchar('action', { length: 100 }).notNull(),
    status: varchar('status', { length: 24 })
      .$type<InfrastructureOperationStatus>()
      .notNull()
      .default('queued'),
    expectedResourceRevision: integer('expected_resource_revision'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: varchar('locked_by', { length: 160 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('infrastructure_operations_idempotency_uidx').on(table.idempotencyKey),
    index('infrastructure_operations_dispatch_idx').on(
      table.nodeId,
      table.status,
      table.nextAttemptAt,
    ),
    index('infrastructure_operations_resource_id_idx').on(table.resourceId),
    index('infrastructure_operations_correlation_id_idx').on(table.correlationId),
    check(
      'infrastructure_operations_status_check',
      sql`${table.status} in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled', 'expired')`,
    ),
    check(
      'infrastructure_operations_attempts_check',
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0 and ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
  ],
)

export const infrastructureDatabaseClusters = pgTable(
  'infrastructure_database_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    engine: varchar('engine', { length: 32 }).notNull().default('postgresql'),
    mode: varchar('mode', { length: 24 }).notNull().default('standalone'),
    status: varchar('status', { length: 24 })
      .$type<InfrastructureDatabaseClusterStatus>()
      .notNull()
      .default('validating'),
    primaryResourceId: uuid('primary_resource_id')
      .notNull()
      .references(() => infrastructureResources.id, { onDelete: 'restrict' }),
    activationOperationId: uuid('activation_operation_id').references(
      () => infrastructureOperations.id,
      { onDelete: 'set null' },
    ),
    adminDatabase: varchar('admin_database', { length: 63 }).notNull().default('postgres'),
    provisionerUsername: varchar('provisioner_username', { length: 63 }).notNull(),
    defaultConnectionLimit: integer('default_connection_limit').notNull().default(20),
    isActive: boolean('is_active').notNull().default(false),
    lastError: text('last_error'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('infrastructure_database_clusters_name_uidx').on(table.name),
    uniqueIndex('infrastructure_database_clusters_primary_resource_uidx').on(
      table.primaryResourceId,
    ),
    index('infrastructure_database_clusters_status_idx').on(table.status),
    check('infrastructure_database_clusters_engine_check', sql`${table.engine} in ('postgresql')`),
    check(
      'infrastructure_database_clusters_mode_check',
      sql`${table.mode} in ('standalone', 'replicated')`,
    ),
    check(
      'infrastructure_database_clusters_status_check',
      sql`${table.status} in ('validating', 'active', 'degraded', 'offline', 'maintenance', 'retired')`,
    ),
    check(
      'infrastructure_database_clusters_connection_limit_check',
      sql`${table.defaultConnectionLimit} > 0`,
    ),
  ],
)

export const resourceObservations = pgTable(
  'resource_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => infrastructureNodes.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => infrastructureResources.id, { onDelete: 'cascade' }),
    observedRevision: integer('observed_revision').notNull(),
    state: varchar('state', { length: 24 }).$type<InfrastructureResourceState>().notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('resource_observations_resource_observed_idx').on(table.resourceId, table.observedAt),
    index('resource_observations_node_observed_idx').on(table.nodeId, table.observedAt),
    check('resource_observations_revision_check', sql`${table.observedRevision} >= 0`),
  ],
)

export const resourceRoutes = pgTable(
  'resource_routes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => infrastructureResources.id, { onDelete: 'cascade' }),
    hostname: varchar('hostname', { length: 253 }).notNull(),
    targetPort: integer('target_port').notNull(),
    tlsEnabled: boolean('tls_enabled').notNull().default(true),
    billingGateEnabled: boolean('billing_gate_enabled').notNull().default(false),
    middleware: jsonb('middleware').$type<string[]>().notNull().default([]),
    desiredStatus: varchar('desired_status', { length: 24 })
      .$type<InfrastructureRouteStatus>()
      .notNull()
      .default('pending'),
    observedStatus: varchar('observed_status', { length: 24 })
      .$type<InfrastructureRouteStatus>()
      .notNull()
      .default('pending'),
    lastError: text('last_error'),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('resource_routes_hostname_uidx').on(table.hostname),
    index('resource_routes_resource_id_idx').on(table.resourceId),
    check('resource_routes_target_port_check', sql`${table.targetPort} between 1 and 65535`),
    check(
      'resource_routes_desired_status_check',
      sql`${table.desiredStatus} in ('pending', 'configuring', 'active', 'failed', 'disabled')`,
    ),
    check(
      'resource_routes_observed_status_check',
      sql`${table.observedStatus} in ('pending', 'configuring', 'active', 'failed', 'disabled')`,
    ),
  ],
)

export const resourceVolumes = pgTable(
  'resource_volumes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => infrastructureNodes.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => infrastructureResources.id, { onDelete: 'restrict' }),
    externalId: varchar('external_id', { length: 200 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    mountTarget: text('mount_target').notNull(),
    kind: varchar('kind', { length: 24 })
      .$type<InfrastructureVolumeKind>()
      .notNull()
      .default('persistent'),
    deleteProtection: boolean('delete_protection').notNull().default(true),
    retentionDays: integer('retention_days'),
    backupPolicy: jsonb('backup_policy').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('resource_volumes_node_external_uidx').on(table.nodeId, table.externalId),
    index('resource_volumes_resource_id_idx').on(table.resourceId),
    check('resource_volumes_kind_check', sql`${table.kind} in ('ephemeral', 'persistent')`),
    check(
      'resource_volumes_retention_check',
      sql`${table.retentionDays} is null or ${table.retentionDays} >= 0`,
    ),
  ],
)

export const resourceSecretReferences = pgTable(
  'resource_secret_references',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => infrastructureResources.id, { onDelete: 'cascade' }),
    environmentKey: varchar('environment_key', { length: 255 }).notNull(),
    secretReference: text('secret_reference').notNull(),
    encryptedValue: text('encrypted_value'),
    delivery: varchar('delivery', { length: 24 }).notNull().default('file'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('resource_secret_references_key_uidx').on(table.resourceId, table.environmentKey),
    check('resource_secret_references_version_check', sql`${table.version} > 0`),
    check('resource_secret_references_delivery_check', sql`${table.delivery} in ('file')`),
  ],
)
