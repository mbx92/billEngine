import type { ApiInfrastructureAllocation, ApiServiceResourceLink } from '../../../shared/types/api'

interface AllocationTarget {
  resourceCount: number | null
  cpuCores: string | null
  memoryBytes: bigint | null
}

export function evaluateInfrastructureAllocation(
  expected: AllocationTarget,
  resources: ApiServiceResourceLink[],
): ApiInfrastructureAllocation {
  const hasCpuTarget = expected.cpuCores !== null
  const hasMemoryTarget = expected.memoryBytes !== null
  const hasCountTarget = expected.resourceCount !== null
  const cpuUnknown = resources.some((resource) => resource.limitsCpus === null)
  const memoryUnknown = resources.some((resource) => resource.limitsMemoryBytes === null)
  const actualCpu = cpuUnknown
    ? null
    : resources.reduce((total, resource) => total + decimalToMilli(resource.limitsCpus), 0n)
  const actualMemory = memoryUnknown
    ? null
    : resources.reduce((total, resource) => total + BigInt(resource.limitsMemoryBytes ?? '0'), 0n)

  const comparisons: number[] = []
  if (hasCountTarget) comparisons.push(compare(resources.length, expected.resourceCount!))
  if (hasCpuTarget && actualCpu !== null) {
    comparisons.push(compare(actualCpu, decimalToMilli(expected.cpuCores)))
  }
  if (hasMemoryTarget && actualMemory !== null) {
    comparisons.push(compare(actualMemory, expected.memoryBytes!))
  }

  let status: ApiInfrastructureAllocation['status']
  if (!hasCountTarget && !hasCpuTarget && !hasMemoryTarget) status = 'not_configured'
  else if ((hasCpuTarget && cpuUnknown) || (hasMemoryTarget && memoryUnknown)) status = 'unknown'
  else if (comparisons.every((value) => value === 0)) status = 'matched'
  else if (comparisons.every((value) => value <= 0)) status = 'under_allocated'
  else if (comparisons.every((value) => value >= 0)) status = 'over_allocated'
  else status = 'mixed'

  return {
    status,
    expected: {
      resourceCount: expected.resourceCount,
      cpuCores: expected.cpuCores,
      memoryBytes: expected.memoryBytes?.toString() ?? null,
    },
    actual: {
      resourceCount: resources.length,
      cpuCores: actualCpu === null ? null : milliToDecimal(actualCpu),
      memoryBytes: actualMemory?.toString() ?? null,
    },
  }
}

function decimalToMilli(value: string | null): bigint {
  if (!value) return 0n
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, '0').slice(0, 3))
}

function milliToDecimal(value: bigint): string {
  const whole = value / 1_000n
  const fraction = (value % 1_000n).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function compare(left: number | bigint, right: number | bigint): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
