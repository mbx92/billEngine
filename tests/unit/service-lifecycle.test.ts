import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServiceCatalogService } from '../../server/services/services/service-catalog-service'

afterEach(() => vi.unstubAllGlobals())

describe('billing-only service lifecycle', () => {
  function fixture(status = 'active') {
    const connection = {
      query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }),
      release: vi.fn(),
    }
    const transaction = { update: vi.fn() }
    const database = {
      $client: { connect: vi.fn().mockResolvedValue(connection) },
      transaction: vi.fn(async (run) => run(transaction)),
    }
    const repository = {
      findById: vi.fn().mockResolvedValue({ id: 's1', status }),
      transition: vi.fn(async (_tx, _id, next) => ({ id: 's1', status: next })),
    }
    const audit = { record: vi.fn() }
    const network = vi.fn().mockRejectedValue(new Error('Coolify unavailable'))
    vi.stubGlobal('fetch', network)
    const service = new ServiceCatalogService(
      database as never,
      repository as never,
      audit as never,
      {} as never,
    )
    return { service, repository, audit, transaction, connection, network }
  }

  it.each([
    ['active', 'suspended'],
    ['suspended', 'active'],
    ['active', 'cancelled'],
  ] as const)('transitions %s to %s without infrastructure calls', async (current, status) => {
    const f = fixture(current)
    await expect(
      f.service.transition('s1', { status, reason: 'Admin request' }, { userId: null }),
    ).resolves.toMatchObject({ status })
    expect(f.network).not.toHaveBeenCalled()
    expect(f.transaction.update).not.toHaveBeenCalled() // no database retention/deletion scheduling
    expect(f.audit.record).toHaveBeenCalledWith(
      f.transaction,
      expect.objectContaining({
        action: `service.${status}`,
        metadata: { accessControl: 'billing-gateway', controlledResourceCount: 0 },
      }),
    )
    expect(f.connection.release).toHaveBeenCalledOnce()
  })

  it('releases the lifecycle lock when persistence fails', async () => {
    const f = fixture()
    f.repository.transition.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(
      f.service.transition(
        's1',
        { status: 'suspended', reason: 'Admin request' },
        { userId: null },
      ),
    ).rejects.toThrow('Database unavailable')
    expect(f.connection.query).toHaveBeenLastCalledWith('select pg_advisory_unlock(hashtext($1))', [
      'service-lifecycle:s1',
    ])
    expect(f.connection.release).toHaveBeenCalledOnce()
    expect(f.network).not.toHaveBeenCalled()
  })

  it('rejects reactivation after cancellation', async () => {
    const f = fixture('cancelled')
    await expect(
      f.service.transition('s1', { status: 'active', reason: 'Admin request' }, { userId: null }),
    ).rejects.toMatchObject({ code: 'STATE_INVALID' })
    expect(f.repository.transition).not.toHaveBeenCalled()
  })
})
