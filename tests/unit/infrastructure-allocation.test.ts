import { describe, expect, it } from 'vitest'
import type { ApiServiceResourceLink } from '../../shared/types/api'
import { evaluateInfrastructureAllocation } from '../../server/services/infrastructure/allocation'

const runningResource = (
  id: string,
  cpu: string | null,
  memory: string | null,
): ApiServiceResourceLink => ({
  id,
  name: `resource-${id}`,
  status: 'running',
  limitsCpus: cpu,
  limitsMemoryBytes: memory,
})

describe('infrastructure allocation compliance', () => {
  it('matches aggregate Coolify limits to the service plan snapshot', () => {
    const result = evaluateInfrastructureAllocation(
      { resourceCount: 2, cpuCores: '2.5', memoryBytes: 3_221_225_472n },
      [runningResource('one', '1', '1073741824'), runningResource('two', '1.5', '2147483648')],
    )

    expect(result.status).toBe('matched')
    expect(result.actual).toEqual({
      resourceCount: 2,
      cpuCores: '2.5',
      memoryBytes: '3221225472',
    })
  })

  it('distinguishes under, over, mixed, and unknown allocations', () => {
    expect(
      evaluateInfrastructureAllocation(
        { resourceCount: 2, cpuCores: '2', memoryBytes: 2_147_483_648n },
        [runningResource('one', '1', '1073741824')],
      ).status,
    ).toBe('under_allocated')

    expect(
      evaluateInfrastructureAllocation(
        { resourceCount: 1, cpuCores: '1', memoryBytes: 1_073_741_824n },
        [runningResource('one', '2', '2147483648')],
      ).status,
    ).toBe('over_allocated')

    expect(
      evaluateInfrastructureAllocation({ resourceCount: 2, cpuCores: '1', memoryBytes: null }, [
        runningResource('one', '2', '1073741824'),
      ]).status,
    ).toBe('mixed')

    expect(
      evaluateInfrastructureAllocation({ resourceCount: null, cpuCores: '1', memoryBytes: null }, [
        runningResource('one', null, '1073741824'),
      ]).status,
    ).toBe('unknown')
  })

  it('reports plans without structured quotas separately', () => {
    expect(
      evaluateInfrastructureAllocation({ resourceCount: null, cpuCores: null, memoryBytes: null }, [
        runningResource('one', null, null),
      ]),
    ).toMatchObject({
      status: 'not_configured',
      actual: { resourceCount: 1, cpuCores: null, memoryBytes: null },
    })
  })
})
