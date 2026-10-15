import { z } from 'zod'

export const NODE_ENVIRONMENTS = ['development', 'staging', 'production'] as const
export const INFRASTRUCTURE_ACTIONS = [
  'application.ensure',
  'application.deploy',
  'application.start',
  'application.stop',
  'application.restart',
  'application.redeploy',
  'application.delete',
  'application.set-limits',
  'database.cluster.activate',
  'database.service.ensure',
  'route.configure',
] as const
export const AGENT_OPERATION_STATUSES = ['running', 'succeeded', 'failed'] as const

const labelsSchema = z.record(z.string().trim().min(1).max(100), z.string().trim().max(300))

const environmentKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]*$/, 'Nama environment variable tidak valid.')

export const createNodeEnrollmentSchema = z.object({
  nodeName: z.string().trim().min(1).max(160),
  environment: z.enum(NODE_ENVIRONMENTS).default('staging'),
  expiresInMinutes: z.number().int().min(5).max(1440).default(30),
  labels: labelsSchema.default({}),
})

export const enrollNodeSchema = z.object({
  token: z.string().trim().min(32).max(512),
  agentVersion: z.string().trim().min(1).max(64),
  protocolVersion: z.string().trim().min(1).max(32),
  osRelease: z.string().trim().min(1).max(160),
  architecture: z.string().trim().min(1).max(32),
  dockerVersion: z.string().trim().min(1).max(64),
  composeVersion: z.string().trim().min(1).max(64),
})

export const nodeCapacitySchema = z.object({
  cpuMilli: z.number().int().positive(),
  memoryBytes: z.string().regex(/^\d+$/),
  diskBytes: z.string().regex(/^\d+$/),
})

export const agentHeartbeatSchema = z.object({
  agentVersion: z.string().trim().min(1).max(64),
  protocolVersion: z.string().trim().min(1).max(32),
  osRelease: z.string().trim().min(1).max(160),
  architecture: z.string().trim().min(1).max(32),
  dockerVersion: z.string().trim().min(1).max(64),
  composeVersion: z.string().trim().min(1).max(64),
  capacity: nodeCapacitySchema,
})

const resourceLimitsSchema = z.object({
  cpuMilli: z.number().int().min(50).max(128_000),
  memoryBytes: z.string().regex(/^\d+$/),
})

const applicationPortSchema = z.object({
  containerPort: z.number().int().min(1).max(65535),
  hostPort: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
})

const healthcheckSchema = z.object({
  path: z
    .string()
    .trim()
    .max(512)
    .regex(/^\/[A-Za-z0-9._~/%-]*$/, 'Healthcheck path mengandung karakter yang tidak aman.'),
  port: z.number().int().min(1).max(65535),
  intervalSeconds: z.number().int().min(5).max(300).default(30),
  timeoutSeconds: z.number().int().min(1).max(60).default(5),
})

const namedVolumeSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/),
  mountTarget: z
    .string()
    .trim()
    .max(1024)
    .regex(/^\/[A-Za-z0-9._/-]*$/, 'Mount target tidak valid.'),
  kind: z.enum(['ephemeral', 'persistent']).default('persistent'),
})

const imageSourceSchema = z.object({
  type: z.literal('image'),
  reference: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/, 'Image reference tidak valid.'),
})

const buildSourceSchema = z.object({
  type: z.literal('build'),
  repositoryUrl: z.string().trim().url().max(2048),
  revision: z.string().trim().min(1).max(255),
  dockerfile: z.string().trim().startsWith('/').max(1024).default('/Dockerfile'),
  context: z.string().trim().startsWith('/').max(1024).default('/'),
})

export const applicationSpecSchema = z.object({
  source: z.discriminatedUnion('type', [imageSourceSchema, buildSourceSchema]),
  limits: resourceLimitsSchema,
  ports: z.array(applicationPortSchema).max(16).default([]),
  environment: z.record(environmentKeySchema, z.string().max(16_384)).default({}),
  secretReferences: z.record(environmentKeySchema, z.string().trim().min(1).max(2048)).default({}),
  volumes: z.array(namedVolumeSchema).max(16).default([]),
  restartPolicy: z.enum(['no', 'on-failure', 'unless-stopped']).default('unless-stopped'),
  healthcheck: healthcheckSchema.optional(),
})

export const createApplicationResourceSchema = z.object({
  nodeId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama aplikasi harus berupa slug lowercase.'),
  classification: z.enum(['billable', 'internal', 'ignored']).default('billable'),
  spec: applicationSpecSchema,
})

export const updateApplicationResourceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama aplikasi harus berupa slug lowercase.'),
  classification: z.enum(['billable', 'internal', 'ignored']),
  spec: applicationSpecSchema,
})

export const operationIdSchema = z.string().uuid()

export const operationStatusUpdateSchema = z.object({
  status: z.enum(AGENT_OPERATION_STATUSES),
  retryable: z.boolean().default(false),
  result: z.record(z.string(), z.unknown()).optional(),
  errorCode: z.string().trim().min(1).max(64).optional(),
  errorMessage: z.string().trim().min(1).max(1000).optional(),
  observedRevision: z.number().int().nonnegative().optional(),
})

export const applicationLifecycleSchema = z.object({
  action: z.enum([
    'application.start',
    'application.stop',
    'application.restart',
    'application.redeploy',
    'application.delete',
  ]),
})

export const inventoryResourceSchema = z.object({
  resourceId: z.string().uuid().optional(),
  externalId: z.string().trim().min(1).max(200),
  kind: z.enum(['application', 'database', 'volume']),
  name: z.string().trim().min(1).max(255),
  state: z.enum([
    'pending',
    'running',
    'stopped',
    'restarting',
    'degraded',
    'deleting',
    'deleted',
    'failed',
    'unknown',
  ]),
  observedRevision: z.number().int().nonnegative().default(0),
  imageReference: z.string().trim().max(500).optional(),
  imageDigest: z.string().trim().max(255).optional(),
  labels: labelsSchema.default({}),
  snapshot: z.record(z.string(), z.unknown()).default({}),
})

export const agentInventorySchema = z.object({
  observedAt: z.string().datetime({ offset: true }),
  resources: z.array(inventoryResourceSchema).max(1000),
})

export type CreateNodeEnrollmentInput = z.infer<typeof createNodeEnrollmentSchema>
export type EnrollNodeInput = z.infer<typeof enrollNodeSchema>
export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>
export type ApplicationSpec = z.infer<typeof applicationSpecSchema>
export type CreateApplicationResourceInput = z.infer<typeof createApplicationResourceSchema>
export type UpdateApplicationResourceInput = z.infer<typeof updateApplicationResourceSchema>
export type OperationStatusUpdateInput = z.infer<typeof operationStatusUpdateSchema>
export type AgentInventoryInput = z.infer<typeof agentInventorySchema>
