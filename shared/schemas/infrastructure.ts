import { z } from 'zod'
import { managedDatabaseBindingSchema } from './native-service-databases'

export const NODE_ENVIRONMENTS = ['development', 'staging', 'production'] as const
export const NODE_ROLES = ['deployment', 'builder', 'hybrid'] as const
export const INFRASTRUCTURE_ACTIONS = [
  'agent.upgrade',
  'agent.rollback',
  'gateway.ensure',
  'application.ensure',
  'application.deploy',
  'application.start',
  'application.stop',
  'application.restart',
  'application.redeploy',
  'application.delete',
  'application.set-limits',
  'container.exec',
  'application.build',
  'image.delete',
  'database.cluster.activate',
  'database.service.ensure',
  'database.backup.create',
  'database.backup.restore',
  'database.backup.delete',
  'route.configure',
  'route.delete',
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
  role: z.enum(NODE_ROLES).optional(),
  expiresInMinutes: z.number().int().min(5).max(1440).default(30),
  labels: labelsSchema.default({}),
})

export const updateNodeRoleSchema = z.object({
  role: z.enum(NODE_ROLES),
})

export const deleteNodeImageSchema = z.object({
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/, 'Docker image ID tidak valid.'),
})

export const enrollNodeSchema = z.object({
  token: z.string().trim().min(32).max(512),
  agentVersion: z.string().trim().min(1).max(64),
  protocolVersion: z.string().trim().min(1).max(32),
  osRelease: z.string().trim().min(1).max(160),
  architecture: z.string().trim().min(1).max(32),
  dockerVersion: z.string().trim().min(1).max(64),
  composeVersion: z.string().trim().min(1).max(64),
  capabilities: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
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
  capabilities: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
  capacity: nodeCapacitySchema,
  usage: z
    .object({
      cpuUsageBasisPoints: z.number().int().min(0).max(10_000).optional(),
      memoryUsedBytes: z.string().regex(/^\d+$/),
      diskUsedBytes: z.string().regex(/^\d+$/),
      diskUsageBasisPoints: z.number().int().min(0).max(10_000),
    })
    .optional(),
  update: z
    .object({
      previousVersion: z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
  gateway: z
    .object({
      status: z.enum(['pending', 'installing', 'healthy', 'failed', 'unknown']),
      image: z.string().trim().min(1).max(160).optional(),
      containerId: z.string().trim().min(1).max(128).optional(),
      error: z.string().trim().min(1).max(1000).optional(),
    })
    .optional(),
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

export const dockerNetworkNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'Nama Docker network tidak valid.')

const imageSourceSchema = z
  .object({
    type: z.literal('image'),
    pullPolicy: z.enum(['always', 'never']).optional(),
    nodeId: z.string().uuid().optional(),
    reference: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/, 'Image reference tidak valid.'),
  })
  .superRefine((source, context) => {
    if (
      source.pullPolicy === 'never' &&
      (!source.nodeId || !/^sha256:[a-f0-9]{64}$/.test(source.reference))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Image lokal wajib menggunakan image ID sha256 dan server asal.',
      })
    }
    if (source.nodeId && source.pullPolicy !== 'never') {
      context.addIssue({ code: 'custom', message: 'Server asal hanya berlaku untuk image lokal.' })
    }
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
  networkName: dockerNetworkNameSchema.default('oc-private'),
  limits: resourceLimitsSchema,
  ports: z.array(applicationPortSchema).max(16).default([]),
  environment: z.record(environmentKeySchema, z.string().max(16_384)).default({}),
  secretReferences: z.record(environmentKeySchema, z.string().trim().min(1).max(2048)).default({}),
  secretDelivery: z.enum(['files', 'environment']).optional(),
  volumes: z.array(namedVolumeSchema).max(16).default([]),
  restartPolicy: z.enum(['no', 'on-failure', 'unless-stopped']).default('unless-stopped'),
  healthcheck: healthcheckSchema.optional(),
})

export const createApplicationResourceSchema = z
  .object({
    nodeId: z.string().uuid(),
    customerId: z.string().uuid().nullable().optional(),
    serviceId: z.string().uuid().optional(),
    managedDatabase: managedDatabaseBindingSchema.optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama aplikasi harus berupa slug lowercase.'),
    classification: z.enum(['billable', 'internal', 'ignored']).default('internal'),
    spec: applicationSpecSchema,
  })
  .superRefine((input, context) => {
    if (input.classification === 'billable' && !input.serviceId) {
      context.addIssue({
        code: 'custom',
        message: 'Service wajib dipilih untuk resource billable.',
        path: ['serviceId'],
      })
    }
    const managedKey = input.managedDatabase?.environmentKey
    if (
      managedKey &&
      (managedKey in input.spec.environment || managedKey in input.spec.secretReferences)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${managedKey} akan disediakan managed database dan tidak boleh diisi manual.`,
        path: ['spec'],
      })
    }
  })

export const updateApplicationResourceSchema = z
  .object({
    serviceId: z.string().uuid().optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama aplikasi harus berupa slug lowercase.'),
    classification: z.enum(['billable', 'internal', 'ignored']),
    spec: applicationSpecSchema,
  })
  .superRefine((input, context) => {
    if (input.classification === 'billable' && !input.serviceId) {
      context.addIssue({
        code: 'custom',
        message: 'Service wajib dipilih untuk resource billable.',
        path: ['serviceId'],
      })
    }
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

export const operationLogAppendSchema = z.object({
  entries: z
    .array(
      z.object({
        occurredAt: z.string().datetime({ offset: true }),
        level: z.enum(['info', 'warning', 'error']),
        message: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(50),
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

export const containerExecSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1, 'Command wajib diisi.')
    .max(2000, 'Command maksimal 2000 karakter.')
    .refine((command) => !command.includes('\0'), 'Command mengandung karakter yang tidak valid.'),
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

export const inventoryImageSchema = z.object({
  id: z.string().trim().min(1).max(128),
  references: z.array(z.string().trim().min(1).max(500)).max(100),
  sizeBytes: z.string().regex(/^\d+$/),
  createdAt: z.string().datetime({ offset: true }),
  used: z.boolean(),
  containerCount: z.number().int().nonnegative(),
})

export const inventoryNetworkSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
  driver: z.string().trim().min(1).max(64),
  scope: z.string().trim().min(1).max(64),
  internal: z.boolean(),
  attachable: z.boolean(),
  managed: z.boolean(),
  containerCount: z.number().int().nonnegative(),
})

export const agentInventorySchema = z.object({
  observedAt: z.string().datetime({ offset: true }),
  resources: z.array(inventoryResourceSchema).max(1000),
  // Optional so agents before image inventory support can continue reporting resources.
  images: z.array(inventoryImageSchema).max(1000).optional(),
  // Optional so older agents remain compatible until network inventory is available.
  networks: z.array(inventoryNetworkSchema).max(1000).optional(),
})

export type CreateNodeEnrollmentInput = z.infer<typeof createNodeEnrollmentSchema>
export type UpdateNodeRoleInput = z.infer<typeof updateNodeRoleSchema>
export type DeleteNodeImageInput = z.infer<typeof deleteNodeImageSchema>
export type EnrollNodeInput = z.infer<typeof enrollNodeSchema>
export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>
export type ApplicationSpec = z.infer<typeof applicationSpecSchema>
export type CreateApplicationResourceInput = z.infer<typeof createApplicationResourceSchema>
export type UpdateApplicationResourceInput = z.infer<typeof updateApplicationResourceSchema>
export type ContainerExecInput = z.infer<typeof containerExecSchema>
export type OperationStatusUpdateInput = z.infer<typeof operationStatusUpdateSchema>
export type OperationLogAppendInput = z.infer<typeof operationLogAppendSchema>
export type AgentInventoryInput = z.infer<typeof agentInventorySchema>
