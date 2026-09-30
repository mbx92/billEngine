import { describe, expect, it } from 'vitest'
import { toAuditJson } from '../../server/repositories/audit'

describe('audit JSON serialization', () => {
  it('preserves bigint values as exact decimal strings', () => {
    expect(
      toAuditJson({
        priceAmount: 9_007_199_254_740_993n,
        nested: { memoryBytes: 2_147_483_648n },
        values: [1n, 2n],
      }),
    ).toEqual({
      priceAmount: '9007199254740993',
      nested: { memoryBytes: '2147483648' },
      values: ['1', '2'],
    })
  })
})
