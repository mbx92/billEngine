import { z } from 'zod'

export const NATIVE_SERVICE_DATABASE_STATUSES = [
  'provisioning',
  'active',
  'failed',
  'pending_deletion',
  'deleted',
] as const

export const provisionNativeServiceDatabaseSchema = z.object({
  serviceId: z.string().uuid(),
  applicationResourceId: z.string().uuid(),
  environmentKey: z
    .string()
    .trim()
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Nama environment variable tidak valid.')
    .default('DATABASE_URL'),
})

export const nativeServiceDatabaseIdSchema = z.string().uuid()

export type ProvisionNativeServiceDatabaseInput = z.infer<
  typeof provisionNativeServiceDatabaseSchema
>
