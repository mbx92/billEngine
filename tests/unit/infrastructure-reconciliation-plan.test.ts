import { describe, expect, it } from 'vitest'
import { buildReconciliationTargets } from '../../server/services/infrastructure/reconciliation-plan'

describe('infrastructure reconciliation plan', () => {
  it('distributes aggregate CPU and memory without losing quota', () => {
    const targets = buildReconciliationTargets(
      [
        { id: 'a', cpuCores: '0.1', memoryBytes: 1n },
        { id: 'b', cpuCores: '0.1', memoryBytes: 1n },
        { id: 'c', cpuCores: '0.1', memoryBytes: 1n },
      ],
      '1',
      1_073_741_824n,
    )

    expect(targets.map((target) => target.desiredCpuCores)).toEqual(['0.334', '0.333', '0.333'])
    expect(targets.reduce((total, target) => total + (target.desiredMemoryBytes ?? 0n), 0n)).toBe(
      1_073_741_824n,
    )
    expect(targets.every((target) => target.changed)).toBe(true)
  })

  it('only compares dimensions configured by the plan', () => {
    expect(
      buildReconciliationTargets([{ id: 'a', cpuCores: '2.000', memoryBytes: 512n }], null, 512n),
    ).toEqual([
      {
        id: 'a',
        desiredCpuCores: null,
        desiredMemoryBytes: 512n,
        changed: false,
      },
    ])
  })
})
