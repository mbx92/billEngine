import { z } from 'zod'
import { applicationSpecSchema } from './infrastructure'

export const TEMPLATE_CATEGORIES = ['application', 'database', 'cache'] as const
export const TEMPLATE_ENGINES = ['generic', 'postgresql', 'mysql', 'redis'] as const

export const templateParameterSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1).max(120),
  environmentKey: z
    .string()
    .trim()
    .regex(/^[A-Z_][A-Z0-9_]*$/),
  type: z.enum(['string', 'secret']),
  required: z.boolean().default(true),
  generated: z.boolean().default(false),
  defaultValue: z.string().max(16_384).optional(),
  help: z.string().trim().max(300).optional(),
})

export const infrastructureTemplateDefinitionSchema = z.object({
  engine: z.enum(TEMPLATE_ENGINES),
  resourceKind: z.enum(['application', 'database']),
  spec: applicationSpecSchema.omit({ environment: true, secretReferences: true }),
  parameters: z.array(templateParameterSchema).max(32),
})

export const deployInfrastructureTemplateSchema = z
  .object({
    nodeId: z.string().uuid(),
    serviceId: z.string().uuid().optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama resource harus berupa slug lowercase.'),
    subdomain: z
      .string()
      .trim()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Subdomain tidak valid.')
      .optional(),
    classification: z.enum(['billable', 'internal', 'ignored']).default('internal'),
    hostPort: z.number().int().min(1).max(65535).optional(),
    values: z.record(z.string(), z.string().max(16_384)).default({}),
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

const templateEnvironmentKeySchema = z
  .string()
  .trim()
  .max(255)
  .regex(/^[A-Z_][A-Z0-9_]*$/, 'Environment key tidak valid.')

export const createApplicationTemplateSchema = z
  .object({
    applicationId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Slug template tidak valid.'),
    description: z.string().trim().max(1000).optional(),
    cpuMilli: z.number().int().min(50).max(128_000),
    memoryMiB: z.number().int().min(16).max(1_048_576),
    containerPort: z.number().int().min(1).max(65535),
    restartPolicy: z.enum(['no', 'on-failure', 'unless-stopped']).default('unless-stopped'),
    healthcheckPath: z
      .string()
      .trim()
      .max(512)
      .regex(/^\/[A-Za-z0-9._~/%-]*$/, 'Healthcheck path tidak valid.')
      .optional(),
    environmentKeys: z.array(templateEnvironmentKeySchema).max(24).default([]),
    secretKeys: z.array(templateEnvironmentKeySchema).max(24).default([]),
    volume: z
      .object({
        name: z
          .string()
          .trim()
          .regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/),
        mountTarget: z
          .string()
          .trim()
          .max(1024)
          .regex(/^\/[A-Za-z0-9._/-]*$/, 'Mount target tidak valid.'),
      })
      .optional(),
    trackLatest: z.boolean().default(true),
  })
  .superRefine((input, context) => {
    const allKeys = [...input.environmentKeys, ...input.secretKeys]
    if (new Set(allKeys).size !== allKeys.length) {
      context.addIssue({
        code: 'custom',
        message: 'Environment dan secret key tidak boleh duplikat.',
        path: ['environmentKeys'],
      })
    }
    if (allKeys.length > 32) {
      context.addIssue({
        code: 'custom',
        message: 'Maksimal 32 environment dan secret key.',
        path: ['environmentKeys'],
      })
    }
  })

export type InfrastructureTemplateDefinition = z.infer<
  typeof infrastructureTemplateDefinitionSchema
>
export type DeployInfrastructureTemplateInput = z.infer<typeof deployInfrastructureTemplateSchema>
export type CreateApplicationTemplateInput = z.infer<typeof createApplicationTemplateSchema>
