import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineEventHandler } from 'h3'
import { CoolifyResourceService } from '../../server/services/coolify/resource-service'
import { CoolifyResourceRepository } from '../../server/repositories/coolify-resources'
import type { Database } from '../../server/database/client'
import type { AuditLogRepository } from '../../server/repositories/audit'
import { coolifyResources, coolifyServers } from '../../server/database/schema'
import { DomainError } from '../../server/utils/errors'

afterEach(() => vi.unstubAllGlobals())

function setup(config = {}) {
  vi.stubGlobal('useRuntimeConfig', () => config)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const repository = {
    findServerConnection: vi.fn().mockResolvedValue({ baseUrl: 'https://coolify.example.test' }),
    deleteServerConnection: vi.fn().mockResolvedValue({ id: 'server' }),
  }
  const service = new CoolifyResourceService(
    {} as Database,
    repository as unknown as CoolifyResourceRepository,
    {} as AuditLogRepository,
  )
  return { service, repository, fetcher }
}

describe('Coolify connection deletion', () => {
  it('deletes only the local connection without contacting Coolify', async () => {
    const { service, repository, fetcher } = setup()
    await expect(service.deleteServer('server', 'admin')).resolves.toEqual({ id: 'server' })
    expect(repository.deleteServerConnection).toHaveBeenCalledWith('server', 'admin')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects missing connections', async () => {
    const { service, repository } = setup()
    repository.findServerConnection.mockResolvedValue(null)
    await expect(service.deleteServer('missing', 'admin')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(repository.deleteServerConnection).not.toHaveBeenCalled()
  })

  it('allows deletion even when obsolete environment credentials are still set', async () => {
    const { service, repository } = setup({
      coolifyApiUrl: 'https://coolify.example.test/',
      coolifyApiToken: 'secret',
    })
    await expect(service.deleteServer('server', 'admin')).resolves.toEqual({ id: 'server' })
    expect(repository.deleteServerConnection).toHaveBeenCalledWith('server', 'admin')
  })

  it('allows deleting a different connection when environment credentials exist', async () => {
    const { service } = setup({
      coolifyApiUrl: 'https://other.example.test',
      coolifyApiToken: 'secret',
    })
    await expect(service.deleteServer('server', 'admin')).resolves.toEqual({ id: 'server' })
  })

  it('translates a nested foreign key restriction into a useful conflict', async () => {
    const { service, repository } = setup()
    repository.deleteServerConnection.mockRejectedValue({ cause: { code: '23503' } })
    await expect(service.deleteServer('server', 'admin')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('preserves unrelated failures', async () => {
    const { service, repository } = setup()
    const failure = new Error('unavailable')
    repository.deleteServerConnection.mockRejectedValue(failure)
    await expect(service.deleteServer('server', 'admin')).rejects.toBe(failure)
  })

  it('rejects non-admin requests before selecting a connection', async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('requireAdmin', vi.fn().mockRejectedValue(DomainError.forbidden()))
    const params = vi.fn()
    vi.stubGlobal('getRouterParam', params)
    const handler = (await import('../../server/api/resources/servers/[id].delete')).default
    await expect(handler({} as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(params).not.toHaveBeenCalled()
  })
})

function databaseFixture(linked: boolean, present = true) {
  const select = vi.fn()
  for (const rows of [
    present ? [{ id: 'server', name: 'Fixture' }] : [],
    [{ id: 'resource' }],
    linked ? [{ id: 'link' }] : [],
  ]) {
    select.mockReturnValueOnce({
      from: () => ({ where: () => ({ for: async () => rows, limit: async () => rows }) }),
    })
  }
  const remove = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  const audit = vi.fn().mockResolvedValue(undefined)
  const tx = { select, delete: remove, insert: () => ({ values: audit }) }
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx))
  const repository = new CoolifyResourceRepository({ transaction } as unknown as Database)
  return { repository, remove, audit, transaction }
}

describe('connection deletion transaction', () => {
  it('rejects billing-linked inventory before deleting any data', async () => {
    const { repository, remove, audit } = databaseFixture(true)
    await expect(repository.deleteServerConnection('server', 'admin')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(remove).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('rejects a concurrently removed server', async () => {
    const { repository, remove } = databaseFixture(false, false)
    await expect(repository.deleteServerConnection('server', 'admin')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(remove).not.toHaveBeenCalled()
  })

  it('removes inventory before the connection and records a non-secret audit in one transaction', async () => {
    const { repository, remove, audit, transaction } = databaseFixture(false)
    await expect(repository.deleteServerConnection('server', 'admin')).resolves.toEqual({
      id: 'server',
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenNthCalledWith(1, coolifyResources)
    expect(remove).toHaveBeenNthCalledWith(2, coolifyServers)
    expect(audit).toHaveBeenCalledWith({
      actorUserId: 'admin',
      action: 'coolify.connection.deleted',
      entityType: 'coolify_server',
      entityId: 'server',
      metadata: { name: 'Fixture', removedResourceCount: 1 },
    })
  })
})
