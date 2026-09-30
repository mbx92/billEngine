import { describe, expect, it, vi } from 'vitest'
import { InfrastructureLifecycleService } from '../../server/services/infrastructure/lifecycle-service'

function targetWithResources() {
  return {
    id: 'service-1',
    resources: [
      {
        id: 'resource-1',
        resourceType: 'application',
        serverId: 'server-1',
        baseUrl: 'https://coolify.example.test',
        tokenEncrypted: null,
        coolifyUuid: 'app-1',
      },
      {
        id: 'resource-2',
        resourceType: 'application',
        serverId: 'server-1',
        baseUrl: 'https://coolify.example.test',
        tokenEncrypted: null,
        coolifyUuid: 'app-2',
      },
    ],
  }
}

describe('infrastructure lifecycle', () => {
  it('stops every linked application and can compensate by starting it again', async () => {
    const client = {
      stopApplication: vi.fn().mockResolvedValue({ message: 'stopped' }),
      startApplication: vi.fn().mockResolvedValue({ message: 'started' }),
    }
    const repository = { findServiceTarget: vi.fn().mockResolvedValue(targetWithResources()) }
    const service = new InfrastructureLifecycleService(
      {} as never,
      repository as never,
      () => client as never,
    )

    const operation = await service.apply('service-1', 'suspended')

    expect(client.stopApplication).toHaveBeenCalledTimes(2)
    expect(operation.affectedCount).toBe(2)
    await expect(operation.rollback()).resolves.toBe(true)
    expect(client.startApplication).toHaveBeenCalledTimes(2)
  })

  it('rolls back resources already stopped when a later stop fails', async () => {
    const client = {
      stopApplication: vi
        .fn()
        .mockResolvedValueOnce({ message: 'stopped' })
        .mockRejectedValueOnce(new Error('Coolify unavailable')),
      startApplication: vi.fn().mockResolvedValue({ message: 'started' }),
    }
    const repository = { findServiceTarget: vi.fn().mockResolvedValue(targetWithResources()) }
    const service = new InfrastructureLifecycleService(
      {} as never,
      repository as never,
      () => client as never,
    )

    await expect(service.apply('service-1', 'suspended')).rejects.toMatchObject({
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
    })
    expect(client.startApplication).toHaveBeenCalledWith('app-1')
  })
})
