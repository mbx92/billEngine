import { describe, expect, it } from 'vitest'
import { updateUserPasswordSchema } from '../../shared/schemas/users'

describe('update user password schema', () => {
  it('accepts a password of at least 12 characters', () => {
    expect(updateUserPasswordSchema.parse({ password: 'super-secret-1' })).toEqual({
      password: 'super-secret-1',
    })
  })

  it('rejects a password that is too short', () => {
    expect(() => updateUserPasswordSchema.parse({ password: 'too-short' })).toThrow()
  })
})
