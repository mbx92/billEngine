import { z } from 'zod'

export const NATIVE_DATABASE_CLUSTER_STATUSES = [
  'validating',
  'active',
  'degraded',
  'offline',
  'maintenance',
  'retired',
] as const

export const createNativeDatabaseClusterSchema = z.object({
  resourceId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Nama cluster harus berupa slug lowercase.'),
  defaultConnectionLimit: z.number().int().min(1).max(10_000).default(20),
})

export type CreateNativeDatabaseClusterInput = z.infer<
  typeof createNativeDatabaseClusterSchema
>
