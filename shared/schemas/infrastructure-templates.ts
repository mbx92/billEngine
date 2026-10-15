import { z } from 'zod'
import { applicationSpecSchema } from './infrastructure'

export const TEMPLATE_CATEGORIES = ['application', 'database', 'cache'] as const
export const TEMPLATE_ENGINES = ['generic', 'postgresql', 'mysql', 'redis'] as const

export const templateParameterSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().trim().min(1).max(120),
  environmentKey: z.string().trim().regex(/^[A-Z_][A-Z0-9_]*$/),
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

export const deployInfrastructureTemplateSchema = z.object({
  nodeId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama resource harus berupa slug lowercase.'),
  classification: z.enum(['billable', 'internal', 'ignored']).default('internal'),
  hostPort: z.number().int().min(1).max(65535),
  values: z.record(z.string(), z.string().max(16_384)).default({}),
})

export type InfrastructureTemplateDefinition = z.infer<
  typeof infrastructureTemplateDefinitionSchema
>
export type DeployInfrastructureTemplateInput = z.infer<
  typeof deployInfrastructureTemplateSchema
>
