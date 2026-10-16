import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROTOCOL_VERSION,
  InfrastructureNodeService,
} from '../../server/services/infrastructure/node-service'

function repository() {
  return {
    listNodes: vi.fn(),
    createEnrollment: vi.fn(),
    consumeEnrollment: vi.fn(),
    findIdentity: vi.fn(),
    recordHeartbeat: vi.fn(),
    recordInventory: vi.fn(),
    revokeNode: vi.fn(),
    findNodeForAgentOperation: vi.fn(),
    queueAgentOperation: vi.fn(),
  }
}

describe('infrastructure node service', () => {
  it('creates a one-time enrollment without storing its raw token', async () => {
    const repo = repository()
    repo.createEnrollment.mockImplementation(async (input) => ({
      id: 'enrollment-id',
      nodeName: input.nodeName,
      environment: input.environment,
      labels: input.labels,
      expiresAt: input.expiresAt,
      createdAt: new Date('2026-10-15T00:00:00Z'),
    }))
    const service = new InfrastructureNodeService(repo)

    const result = await service.createEnrollment(
      { nodeName: 'staging-01', environment: 'staging', expiresInMinutes: 30, labels: {} },
      '00000000-0000-4000-8000-000000000001',
    )

    expect(result.token).toMatch(/^oc_enroll_/)
    expect(repo.createEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        actorUserId: '00000000-0000-4000-8000-000000000001',
      }),
    )
    expect(repo.createEnrollment.mock.calls[0]?.[0].tokenHash).not.toBe(result.token)
  })

  it('rejects non-Ubuntu enrollment before touching the database', async () => {
    const repo = repository()
    const service = new InfrastructureNodeService(repo)

    await expect(
      service.enroll({
        token: `oc_enroll_${'a'.repeat(40)}`,
        agentVersion: '0.1.0',
        protocolVersion: AGENT_PROTOCOL_VERSION,
        osRelease: 'Debian GNU/Linux 13',
        architecture: 'amd64',
        dockerVersion: '28.0.0',
        composeVersion: '2.39.0',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repo.consumeEnrollment).not.toHaveBeenCalled()
  })

  it('issues an agent credential only after enrollment is consumed', async () => {
    const repo = repository()
    repo.consumeEnrollment.mockResolvedValue({
      nodeId: '00000000-0000-4000-8000-000000000002',
      nodeName: 'staging-01',
      environment: 'staging',
    })
    const service = new InfrastructureNodeService(repo)

    const result = await service.enroll({
      token: `oc_enroll_${'a'.repeat(40)}`,
      agentVersion: '0.1.0',
      protocolVersion: AGENT_PROTOCOL_VERSION,
      osRelease: 'Ubuntu 24.04 LTS',
      architecture: 'amd64',
      dockerVersion: '28.0.0',
      composeVersion: '2.39.0',
    })

    expect(result.credential).toMatch(/^oc_agent_/)
    expect(repo.consumeEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        credentialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    expect(repo.consumeEnrollment.mock.calls[0]?.[0].credentialHash).not.toBe(result.credential)
  })
})
