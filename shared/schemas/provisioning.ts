import { z } from 'zod'
import { sqlImportSchema } from './database-provisioning'

export const DEPLOYMENT_BUILD_PACKS = [
  'nixpacks',
  'railpack',
  'static',
  'dockerfile',
  'dockercompose',
] as const

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  )

const environmentKeySchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim().replace(/^export\s+/i, '')
    const separator = normalized.indexOf('=')
    return (separator >= 0 ? normalized.slice(0, separator) : normalized).trim()
  },
  z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Nama environment key tidak valid.'),
)

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((value) => {
    if (value.includes('://') || value.includes('/') || !value.includes('.')) return false
    return value.split('.').every((label) => {
      return (
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      )
    })
  }, 'Hostname tidak valid.')

const deploymentBlueprintSchema = z.object({
  coolifyServerId: z.uuid(),
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug hanya boleh berisi huruf, angka, dan dash.'),
  description: optionalText(5_000),
  repositoryUrl: z
    .url()
    .max(2_000)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'Repository harus menggunakan URL HTTP(S).',
    }),
  branch: z.string().trim().min(1).max(255).default('main'),
  buildPack: z.enum(DEPLOYMENT_BUILD_PACKS),
  projectUuid: z.string().trim().min(1).max(160),
  targetServerUuid: z.string().trim().min(1).max(160),
  environmentName: z.string().trim().min(1).max(160).default('production'),
  destinationUuid: optionalText(160),
  baseDirectory: optionalText(2_000),
  dockerfileLocation: optionalText(2_000),
  dockerComposeLocation: optionalText(2_000),
  composeServiceName: optionalText(160),
  portsExposes: optionalText(255),
  healthcheckPath: optionalText(2_000),
  healthcheckPort: optionalText(32),
  environmentKeys: z
    .array(environmentKeySchema)
    .max(100)
    .default([])
    .refine((keys) => new Set(keys).size === keys.length, 'Environment key harus unik.'),
  customLabels: optionalText(20_000),
  billingGateEnabled: z.boolean().default(true),
  databaseClusterId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.uuid().optional(),
  ),
  databaseEnvironmentKey: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default('DATABASE_URL'),
})

function validateDeploymentBlueprint(
  input: z.infer<typeof deploymentBlueprintSchema>,
  context: z.RefinementCtx,
) {
  if (input.buildPack === 'dockercompose' && !input.dockerComposeLocation) {
    context.addIssue({
      code: 'custom',
      path: ['dockerComposeLocation'],
      message: 'Lokasi Docker Compose wajib untuk build pack dockercompose.',
    })
  }
  if (input.buildPack === 'dockerfile' && !input.dockerfileLocation) {
    context.addIssue({
      code: 'custom',
      path: ['dockerfileLocation'],
      message: 'Lokasi Dockerfile wajib untuk build pack dockerfile.',
    })
  }
}

export const createDeploymentBlueprintSchema = deploymentBlueprintSchema.superRefine(
  validateDeploymentBlueprint,
)

export const updateDeploymentBlueprintSchema = deploymentBlueprintSchema
  .extend({ isActive: z.boolean() })
  .superRefine(validateDeploymentBlueprint)

export const deploymentBlueprintIdSchema = z.uuid()

export const provisioningProjectsQuerySchema = z.object({
  serverId: z.uuid(),
})

export const queueProvisioningJobSchema = z
  .object({
    blueprintId: z.uuid(),
    serviceId: z.uuid(),
    applicationName: z.string().trim().min(2).max(255),
    hostname: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      hostnameSchema.optional(),
    ),
    domainType: z.enum(['platform', 'custom']).optional(),
    environmentVariables: z.record(z.string(), z.string()).default({}),
    sqlImport: sqlImportSchema.optional(),
  })
  .superRefine((input, context) => {
    if (Boolean(input.hostname) !== Boolean(input.domainType)) {
      context.addIssue({
        code: 'custom',
        path: input.hostname ? ['domainType'] : ['hostname'],
        message: 'Hostname dan tipe domain harus diisi bersama.',
      })
    }
  })

export type CreateDeploymentBlueprintInput = z.infer<typeof createDeploymentBlueprintSchema>
export type UpdateDeploymentBlueprintInput = z.infer<typeof updateDeploymentBlueprintSchema>
export type QueueProvisioningJobInput = z.infer<typeof queueProvisioningJobSchema>
