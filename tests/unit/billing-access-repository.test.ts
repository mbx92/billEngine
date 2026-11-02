import { describe, expect, it, vi } from 'vitest'
import { BillingAccessRepository } from '../../server/repositories/billing-access'

describe('gateway host ownership', () => {
  function repository(rows: Array<{ id: string; status: string; fqdn: string }>) {
    const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn().mockResolvedValue(rows) }
    query.from.mockReturnValue(query)
    query.innerJoin.mockReturnValue(query)
    return new BillingAccessRepository({ select: () => query } as never)
  }
  const cancelled = { id: 'old', status: 'cancelled', fqdn: 'https://app.example.test' }

  it('retains cancelled ownership until reassignment', async () => {
    await expect(
      repository([cancelled]).findServiceByHost('app.example.test'),
    ).resolves.toMatchObject({ id: 'old' })
  })

  it('uses the current contract after reassignment', async () => {
    const active = { ...cancelled, id: 'new', status: 'active' }
    await expect(
      repository([cancelled, active]).findServiceByHost('app.example.test'),
    ).resolves.toMatchObject({ id: 'new' })
  })

  it('allows unknown and ambiguous hosts', async () => {
    const repo = repository([
      { ...cancelled, status: 'active' },
      { ...cancelled, id: 'other', status: 'suspended' },
    ])
    await expect(repo.findServiceByHost('app.example.test')).resolves.toBeNull()
    await expect(repo.findServiceByHost('unknown.example.test')).resolves.toBeNull()
  })
})
