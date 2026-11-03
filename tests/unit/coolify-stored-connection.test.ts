import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineEventHandler } from 'h3'
import { clientForCoolifyConnection } from '../../server/integrations/coolify/connection'
import { encryptCredential } from '../../server/utils/credentials'
import { CoolifyResourceService } from '../../server/services/coolify/resource-service'
import type { CoolifyResourceRepository } from '../../server/repositories/coolify-resources'
import type { AuditLogRepository } from '../../server/repositories/audit'
import type { Database } from '../../server/database/client'
import { DomainError } from '../../server/utils/errors'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup() {
  vi.stubGlobal('useRuntimeConfig', () => ({
    coolifyCredentialsKey: 'test-key',
    // Obsolete settings must never create a connection or supply a token.
    coolifyApiUrl: 'https://legacy.example.test',
    coolifyApiToken: 'obsolete-token',
  }))
  const repository = {
    listServers: vi.fn().mockResolvedValue([{ id: 'server', credentialSource: 'missing' }]),
    listActiveServerConnections: vi.fn().mockResolvedValue([]),
    findOrCreateServer: vi.fn(),
    findServerConnection: vi.fn().mockResolvedValue({
      baseUrl: 'https://saved.example.test',
      isActive: true,
      tokenEncrypted: encryptCredential('stored-token'),
    }),
  }
  const service = new CoolifyResourceService(
    {} as Database,
    repository as unknown as CoolifyResourceRepository,
    {} as AuditLogRepository,
  )
  const request = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', request)
  return { service, repository, request }
}

describe('database-managed Coolify connections', () => {
  it('uses the selected connection URL and encrypted token', async () => {
    const { service, request } = setup()
    await expect(service.testConnection('server')).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith(
      new URL('https://saved.example.test/api/v1/version'),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer stored-token' }),
      }),
    )
  })

  it('does not fall back to an old environment token', () => {
    const { request } = setup()
    expect(() =>
      clientForCoolifyConnection({ baseUrl: 'https://legacy.example.test', tokenEncrypted: null }),
    ).toThrow('Perbarui token')
    expect(request).not.toHaveBeenCalled()
  })

  it('does not recreate connections from environment settings during sync', async () => {
    const { service, repository, request } = setup()
    await expect(service.sync('admin')).rejects.toMatchObject({ code: 'STATE_INVALID' })
    expect(repository.findOrCreateServer).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('lists stored records without marking missing tokens as environment credentials', async () => {
    const { service } = setup()
    await expect(service.listServers()).resolves.toEqual([
      { id: 'server', credentialSource: 'missing' },
    ])
  })

  it('rejects a missing or inactive selected connection', async () => {
    const { service, repository, request } = setup()
    repository.findServerConnection.mockResolvedValue(null)
    await expect(service.testConnection('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    repository.findServerConnection.mockResolvedValue({
      baseUrl: 'https://saved.example.test',
      isActive: false,
      tokenEncrypted: 'unused',
    })
    await expect(service.testConnection('inactive')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(request).not.toHaveBeenCalled()
  })

  it('requires admin authorization before reading the connection-test body', async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('requireAdmin', vi.fn().mockRejectedValue(DomainError.forbidden()))
    const body = vi.fn()
    vi.stubGlobal('readBody', body)
    const handler = (await import('../../server/api/coolify/test-connection.post')).default
    await expect(handler({} as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(body).not.toHaveBeenCalled()
  })

  it('requires an explicit valid server ID for connection testing', async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('requireAdmin', vi.fn().mockResolvedValue({ user: { id: 'admin' } }))
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({}))
    const testConnection = vi.spyOn(CoolifyResourceService.prototype, 'testConnection')
    const handler = (await import('../../server/api/coolify/test-connection.post')).default
    await expect(handler({} as never)).rejects.toMatchObject({ name: 'ZodError' })
    expect(testConnection).not.toHaveBeenCalled()
  })
})
