import { describe, expect, it } from 'vitest'
import {
  bulkUpdateResourceClassificationSchema,
  resourceListQuerySchema,
  updateResourceClassificationSchema,
} from '../../shared/schemas/coolify'

const resourceId = '22222222-2222-4222-8222-222222222222'

describe('resource management schemas', () => {
  it('normalizes list filters and pagination', () => {
    const parsed = resourceListQuerySchema.parse({
      page: '2',
      perPage: '50',
      q: '  production  ',
      status: 'running',
      classification: 'billable',
      assignment: 'not_billed',
    })

    expect(parsed).toEqual({
      page: 2,
      perPage: 50,
      q: 'production',
      status: 'running',
      classification: 'billable',
      assignment: 'not_billed',
    })
  })

  it('accepts each supported classification', () => {
    for (const classification of ['billable', 'internal', 'ignored']) {
      expect(updateResourceClassificationSchema.parse({ classification })).toEqual({
        classification,
      })
    }
  })

  it('rejects duplicate bulk resource ids', () => {
    const result = bulkUpdateResourceClassificationSchema.safeParse({
      resourceIds: [resourceId, resourceId],
      classification: 'internal',
    })

    expect(result.success).toBe(false)
  })
})
