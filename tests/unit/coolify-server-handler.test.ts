import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineEventHandler } from 'h3'
import { CoolifyClientError } from '../../server/integrations/coolify/client'
import { toApiError } from '../../server/utils/api-error'

const { createServer } = vi.hoisted(() => ({ createServer: vi.fn() }))
vi.mock('../../server/services/coolify/resource-service', () => ({
  CoolifyResourceService: class {
    createServer = createServer
  },
}))

describe('add Coolify server error handling', () => {
  let handler: (event: never) => unknown
  const setStatus = vi.fn()
  beforeAll(async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('requireAdmin', vi.fn().mockResolvedValue({ user: { id: 'admin' } }))
    vi.stubGlobal(
      'readBody',
      vi.fn().mockResolvedValue({
        name: 'Test Coolify',
        baseUrl: 'https://coolify.example.test',
        apiToken: 'fake-test-token',
      }),
    )
    vi.stubGlobal('setResponseStatus', setStatus)
    handler = (await import('../../server/api/resources/servers.post')).default
  })
  beforeEach(() => {
    createServer.mockReset()
    setStatus.mockClear()
  })
  afterAll(() => vi.unstubAllGlobals())

  it.each([
    [new Error('COOLIFY_SERVER_EXISTS'), 409, 'CONFLICT'],
    [new CoolifyClientError('Coolify API token ditolak.', 401), 502, 'EXTERNAL_SERVICE_ERROR'],
    [
      new Error('query failed', {
        cause: Object.assign(new Error('missing table'), { code: '42P01' }),
      }),
      503,
      'DATABASE_SCHEMA_MISMATCH',
    ],
    [new Error('unexpected private details'), 500, 'INTERNAL_ERROR'],
  ])('preserves the underlying failure category (%s)', async (error, status, code) => {
    createServer.mockRejectedValue(error)
    let thrown: unknown
    try {
      await handler({} as never)
    } catch (caught) {
      thrown = caught
    }
    expect(thrown).toBeDefined()
    expect(toApiError(thrown)).toMatchObject({ statusCode: status, body: { error: { code } } })
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('returns 201 for a successful connection and sync', async () => {
    const result = { serverId: 's1', processedCount: 2, nodeCount: 1 }
    createServer.mockResolvedValue(result)
    await expect(handler({} as never)).resolves.toEqual({ data: result })
    expect(setStatus).toHaveBeenCalledWith({}, 201)
  })
})
