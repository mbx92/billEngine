import { z } from 'zod'

export const DATABASE_MODES = ['none', 'shared', 'dedicated'] as const
export const DATABASE_SSL_MODES = ['disable', 'prefer', 'require'] as const
export const MAX_SQL_IMPORT_BYTES = 10 * 1024 * 1024

const pgIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(/^[a-z_][a-z0-9_]*$/i, 'Identifier PostgreSQL tidak valid.')

export const createDatabaseClusterSchema = z.object({
  coolifyServerId: z.uuid(),
  name: z.string().trim().min(2).max(160),
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  adminDatabase: pgIdentifier.default('postgres'),
  provisionerUsername: pgIdentifier,
  password: z.string().min(8).max(1_000),
  sslMode: z.enum(DATABASE_SSL_MODES).default('prefer'),
  defaultConnectionLimit: z.coerce.number().int().min(1).max(10_000).default(20),
  isActive: z.boolean().default(true),
})

export const updateDatabaseClusterSchema = createDatabaseClusterSchema
  .partial()
  .extend({ password: z.string().min(8).max(1_000).optional() })
  .refine((value) => Object.keys(value).length > 0, 'Tidak ada perubahan cluster.')

export const databaseClusterIdSchema = z.uuid()

export const sqlImportSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    content: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (!value.filename.toLowerCase().endsWith('.sql')) {
      context.addIssue({
        code: 'custom',
        path: ['filename'],
        message: 'File harus berekstensi .sql.',
      })
    }
    if (new TextEncoder().encode(value.content).byteLength > MAX_SQL_IMPORT_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: `File SQL maksimal ${MAX_SQL_IMPORT_BYTES / 1024 / 1024} MB.`,
      })
    }
  })

export type DatabaseMode = (typeof DATABASE_MODES)[number]
export type CreateDatabaseClusterInput = z.infer<typeof createDatabaseClusterSchema>
export type UpdateDatabaseClusterInput = z.infer<typeof updateDatabaseClusterSchema>
