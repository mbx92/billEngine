import { z } from 'zod'

const slugPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Prefix object storage tidak valid.')

export const createBackupTargetSchema = z.object({
  name: z.string().trim().min(2).max(160),
  endpoint: z.string().trim().url().max(2048),
  region: z.string().trim().min(1).max(100).default('auto'),
  bucket: z.string().trim().min(3).max(255).regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
  prefix: slugPathSchema.default('oc-backups'),
  pathStyle: z.boolean().default(false),
  accessKey: z.string().trim().min(3).max(1024),
  secretKey: z.string().trim().min(8).max(4096),
})

export const createBackupPolicySchema = z.object({
  name: z.string().trim().min(2).max(160),
  serviceDatabaseId: z.string().uuid(),
  storageTargetId: z.string().uuid(),
  intervalMinutes: z.number().int().min(5).max(525_600),
  retentionCount: z.number().int().min(1).max(1000),
  alertEmail: z.string().trim().email().max(320).nullable().optional(),
})

export type CreateBackupTargetInput = z.infer<typeof createBackupTargetSchema>
export type CreateBackupPolicyInput = z.infer<typeof createBackupPolicySchema>
