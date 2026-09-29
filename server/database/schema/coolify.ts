import {
  bigint,
  boolean,
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
import { resourceClassification, resourceStatus } from './enums'

export const coolifyServers = pgTable('coolify_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  baseUrl: text('base_url').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('unknown'),
  isActive: boolean('is_active').notNull().default(true),
  tokenEncrypted: text('token_encrypted'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastSyncStatus: varchar('last_sync_status', { length: 32 }),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const coolifyNodes = pgTable(
  'coolify_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    coolifyServerId: uuid('coolify_server_id')
      .notNull()
      .references(() => coolifyServers.id, { onDelete: 'cascade' }),
    coolifyUuid: varchar('coolify_uuid', { length: 160 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    address: text('address'),
    sshPort: integer('ssh_port'),
    status: varchar('status', { length: 32 }).notNull().default('unknown'),
    isReachable: boolean('is_reachable').notNull().default(false),
    isUsable: boolean('is_usable').notNull().default(false),
    isCoolifyHost: boolean('is_coolify_host').notNull().default(false),
    rawMetadata: jsonb('raw_metadata'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coolify_nodes_server_uuid_uidx').on(table.coolifyServerId, table.coolifyUuid),
    index('coolify_nodes_server_id_idx').on(table.coolifyServerId),
    index('coolify_nodes_status_idx').on(table.status),
  ],
)

export const coolifyResources = pgTable(
  'coolify_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    coolifyServerId: uuid('coolify_server_id')
      .notNull()
      .references(() => coolifyServers.id, { onDelete: 'restrict' }),
    coolifyUuid: varchar('coolify_uuid', { length: 160 }).notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: resourceStatus('status').notNull().default('unknown'),
    classification: resourceClassification('classification').notNull().default('billable'),
    fqdn: text('fqdn'),
    projectName: varchar('project_name', { length: 255 }),
    environmentName: varchar('environment_name', { length: 255 }),
    coolifyNodeUuid: varchar('coolify_node_uuid', { length: 160 }),
    limitsCpus: numeric('limits_cpus', { precision: 10, scale: 3 }),
    limitsCpuset: varchar('limits_cpuset', { length: 100 }),
    limitsCpuShares: integer('limits_cpu_shares'),
    limitsMemoryBytes: bigint('limits_memory_bytes', { mode: 'bigint' }),
    memoryReservationBytes: bigint('memory_reservation_bytes', { mode: 'bigint' }),
    memorySwapBytes: bigint('memory_swap_bytes', { mode: 'bigint' }),
    rawMetadata: jsonb('raw_metadata'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coolify_resources_server_uuid_uidx').on(table.coolifyServerId, table.coolifyUuid),
    index('coolify_resources_server_id_idx').on(table.coolifyServerId),
    index('coolify_resources_node_uuid_idx').on(table.coolifyNodeUuid),
    index('coolify_resources_status_idx').on(table.status),
    index('coolify_resources_classification_idx').on(table.classification),
    index('coolify_resources_last_seen_at_idx').on(table.lastSeenAt),
  ],
)
