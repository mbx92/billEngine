import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineEventHandler } from 'h3'
import { CoolifyResourceService } from '../../server/services/coolify/resource-service'
import { CoolifyResourceRepository } from '../../server/repositories/coolify-resources'
import type { Database } from '../../server/database/client'
import type { AuditLogRepository } from '../../server/repositories/audit'
import { decryptCredential } from '../../server/utils/credentials'
import { DomainError } from '../../server/utils/errors'

afterEach(() => vi.unstubAllGlobals())

function setup(status = 200) {
  vi.stubGlobal('useRuntimeConfig', () => ({ coolifyCredentialsKey: 'test-encryption-key' }))
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(status === 200 ? '[]' : 'private response', {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    )
  vi.stubGlobal('fetch', fetcher)
  const repository = {
    findServerConnection: vi
      .fn()
      .mockResolvedValue({ baseUrl: 'https://coolify.example.test', isActive: true }),
    replaceServerToken: vi.fn().mockResolvedValue({ id: 'server' }),
  }
  const service = new CoolifyResourceService(
    {} as Database,
    repository as unknown as CoolifyResourceRepository,
    {} as AuditLogRepository,
  )
  return { service, repository, fetcher }
}

describe('Coolify token replacement', () => {
  it('tests both inventory endpoints before persisting an encrypted token on the same connection', async () => {
    const { service, repository, fetcher } = setup()
    await expect(service.replaceServerToken('server', 'new-token', 'admin')).resolves.toEqual({
      id: 'server',
    })
    expect(fetcher.mock.calls.map((args) => String(args[0])).sort()).toEqual([
      'https://coolify.example.test/api/v1/applications',
      'https://coolify.example.test/api/v1/servers',
    ])
    const [id, encrypted, actor] = repository.replaceServerToken.mock.calls[0]!
    expect(id).toBe('server')
    expect(actor).toBe('admin')
    expect(encrypted).not.toBe('new-token')
    expect(decryptCredential(encrypted)).toBe('new-token')
  })
  it.each([401, 403, 502])(
    'does not replace the stored token when validation fails with %s',
    async (status) => {
      const { service, repository } = setup(status)
      await expect(service.replaceServerToken('server', 'bad-token', 'admin')).rejects.toThrow()
      expect(repository.replaceServerToken).not.toHaveBeenCalled()
    },
  )
  it('does not contact Coolify for an inactive or missing connection', async () => {
    const { service, repository, fetcher } = setup()
    repository.findServerConnection.mockResolvedValue(null)
    await expect(service.replaceServerToken('missing', 'token', 'admin')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('records only non-secret metadata in the token rotation audit', async () => {
    const set = vi
      .fn()
      .mockReturnValue({
        where: vi
          .fn()
          .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'server' }]) }),
      })
    const values = vi.fn().mockResolvedValue(undefined)
    const transaction = {
      update: vi.fn().mockReturnValue({ set }),
      insert: vi.fn().mockReturnValue({ values }),
    }
    const database = {
      transaction: async (fn: (tx: typeof transaction) => unknown) => fn(transaction),
    }
    await new CoolifyResourceRepository(database as unknown as Database).replaceServerToken(
      'server',
      'encrypted-sensitive-value',
      'admin',
    )
    expect(set.mock.calls[0]![0].tokenEncrypted).toBe('encrypted-sensitive-value')
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'server', metadata: { credentialSource: 'stored' } }),
    )
    expect(JSON.stringify(values.mock.calls)).not.toContain('encrypted-sensitive-value')
  })
  it('rejects non-admin requests before parsing or handling any token', async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('requireAdmin', vi.fn().mockRejectedValue(DomainError.forbidden()))
    const body = vi.fn()
    vi.stubGlobal('readBody', body)
    const handler = (await import('../../server/api/resources/servers/[id]/token.put')).default
    await expect(handler({} as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(body).not.toHaveBeenCalled()
  })
})
