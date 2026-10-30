import { z } from 'zod'

export const environmentVariableSchema = z
  .object({
    key: z
      .string()
      .trim()
      .max(255)
      .regex(/^[A-Z_][A-Z0-9_]*$/, 'Nama variable harus berupa KEY_HURUF_BESAR.'),
    value: z
      .string()
      .max(16_384)
      .refine((value) => !value.includes('\0'), 'Nilai tidak boleh berisi karakter NUL.')
      .optional(),
    secret: z.boolean().default(false),
  })
  .superRefine((variable, context) => {
    if (!variable.secret && variable.value === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Nilai variable wajib diisi; string kosong diperbolehkan.',
      })
    }
    if (variable.secret && variable.value === '') {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Nilai secret baru tidak boleh kosong.',
      })
    }
  })

export const updateApplicationEnvironmentSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    variables: z.array(environmentVariableSchema).max(200),
  })
  .superRefine((input, context) => {
    const keys = new Set<string>()
    input.variables.forEach((variable, index) => {
      if (keys.has(variable.key))
        context.addIssue({
          code: 'custom',
          path: ['variables', index, 'key'],
          message: `Variable ${variable.key} duplikat.`,
        })
      keys.add(variable.key)
    })
  })

export type UpdateApplicationEnvironmentInput = z.infer<typeof updateApplicationEnvironmentSchema>
