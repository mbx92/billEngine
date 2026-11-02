import { createError } from 'h3'
import { describe, expect, it } from 'vitest'
import { toApiError } from '../../server/utils/api-error'

describe('removed API routes', () => {
  it.each(['42P01', '42703'])('identifies schema errors through wrapped causes (%s)', (code) => {
    const error = new Error('Failed query containing private parameters', {
      cause: Object.assign(new Error('private database detail'), { code }),
    })
    const result = toApiError(createError({ cause: error }))
    expect(result.statusCode).toBe(503)
    expect(result.body.error.code).toBe('DATABASE_SCHEMA_MISMATCH')
    expect(result.body.error.message).toContain('Skema database')
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('preserves a framework 404 without exposing request details', () => {
    const error = createError({ statusCode: 404, message: 'Missing /private/path?token=secret' })
    expect(toApiError(error)).toEqual({
      statusCode: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } },
    })
  })

  it('preserves a wrapped framework 404', () => {
    expect(
      toApiError(new Error('wrapper', { cause: createError({ statusCode: 404 }) })).statusCode,
    ).toBe(404)
  })

  it('keeps unexpected errors private', () => {
    const result = toApiError(new Error('private database connection details'))
    expect(result.statusCode).toBe(500)
    expect(JSON.stringify(result)).not.toContain('private database')
  })
})
