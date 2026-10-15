import { describe, expect, it } from 'vitest'
import { requireIdempotencyKey } from '../../server/services/infrastructure/native-service'

describe('native infrastructure service', () => {
  it('accepts stable idempotency keys', () => {
    expect(requireIdempotencyKey('deploy:customer-1:revision-2')).toBe(
      'deploy:customer-1:revision-2',
    )
  })

  it('rejects missing, short, or unsafe idempotency keys', () => {
    expect(() => requireIdempotencyKey(undefined)).toThrow('Idempotency-Key')
    expect(() => requireIdempotencyKey('short')).toThrow('Idempotency-Key')
    expect(() => requireIdempotencyKey('contains spaces')).toThrow('Idempotency-Key')
  })
})
