import { z } from 'zod'

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
