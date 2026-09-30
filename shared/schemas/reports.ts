import { z } from 'zod'

export const reportRangeSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((range) => !range.from || !range.to || range.from <= range.to, {
    path: ['to'],
    message: 'Tanggal akhir tidak boleh sebelum tanggal awal.',
  })

export type ReportRangeInput = z.infer<typeof reportRangeSchema>
