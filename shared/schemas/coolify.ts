import { z } from 'zod'
import { RESOURCE_CLASSIFICATIONS, RESOURCE_STATUSES } from '../constants/domain'
import { paginationSchema } from './common'

export const createCoolifyServerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  baseUrl: z
    .url()
    .max(2_000)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'URL harus menggunakan HTTP atau HTTPS.',
    }),
  apiToken: z.string().trim().min(10).max(2_000),
})

export type CreateCoolifyServerInput = z.infer<typeof createCoolifyServerSchema>

const optionalQueryText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(200).optional(),
)

export const resourceListQuerySchema = paginationSchema.extend({
  q: optionalQueryText,
  status: z.enum(RESOURCE_STATUSES).optional(),
  classification: z.enum(RESOURCE_CLASSIFICATIONS).optional(),
  assignment: z.enum(['assigned', 'unassigned', 'not_billed']).optional(),
})

export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>

export const updateResourceClassificationSchema = z.object({
  classification: z.enum(RESOURCE_CLASSIFICATIONS),
})

export type UpdateResourceClassificationInput = z.infer<typeof updateResourceClassificationSchema>

export const bulkUpdateResourceClassificationSchema = updateResourceClassificationSchema.extend({
  resourceIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Resource yang sama tidak boleh dipilih lebih dari sekali.',
    }),
})

export type BulkUpdateResourceClassificationInput = z.infer<
  typeof bulkUpdateResourceClassificationSchema
>

export const resourceMetricsQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(100)),
})
