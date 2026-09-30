import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from '../../app/lib/api-error'

describe('client API error messages', () => {
  it('shows the first field validation message instead of a generic error', () => {
    expect(
      apiErrorMessage(
        {
          data: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Input tidak valid.',
              details: [{ path: ['includedCpuCores'], message: 'CPU harus lebih besar dari nol.' }],
            },
          },
        },
        'Plan gagal disimpan.',
      ),
    ).toBe('CPU harus lebih besar dari nol.')
  })
})
