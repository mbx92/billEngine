import { z } from 'zod'

export const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(200),
    role: z.enum(['admin', 'customer']),
    customerId: z.uuid().nullable().optional(),
  })
  .superRefine((input, context) => {
    if (input.role === 'customer' && !input.customerId) {
      context.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Customer wajib dipilih untuk role customer.',
      })
    }
  })

export const updateUserAccessSchema = z
  .object({
    role: z.enum(['super_admin', 'admin', 'customer']).optional(),
    customerId: z.uuid().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Tidak ada perubahan akses.')

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserAccessInput = z.infer<typeof updateUserAccessSchema>
