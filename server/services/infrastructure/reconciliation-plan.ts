export interface ReconciliationPlanResource {
  id: string
  cpuCores: string | null
  memoryBytes: bigint | null
}

export interface ReconciliationPlanTarget {
  id: string
  desiredCpuCores: string | null
  desiredMemoryBytes: bigint | null
  changed: boolean
}

/**
 * Plan CPU and memory are aggregate service quotas. Split them deterministically
 * over all linked resources while preserving the exact totals.
 */
export function buildReconciliationTargets(
  resources: ReconciliationPlanResource[],
  totalCpuCores: string | null,
  totalMemoryBytes: bigint | null,
): ReconciliationPlanTarget[] {
  if (resources.length === 0) return []

  const cpuShares =
    totalCpuCores === null
      ? null
      : distribute(decimalToMilli(totalCpuCores), resources.length).map(milliToDecimal)
  const memoryShares =
    totalMemoryBytes === null ? null : distribute(totalMemoryBytes, resources.length)

  return resources.map((resource, index) => {
    const desiredCpuCores = cpuShares?.[index] ?? null
    const desiredMemoryBytes = memoryShares?.[index] ?? null
    return {
      id: resource.id,
      desiredCpuCores,
      desiredMemoryBytes,
      changed:
        (desiredCpuCores !== null &&
          decimalToMilli(resource.cpuCores) !== decimalToMilli(desiredCpuCores)) ||
        (desiredMemoryBytes !== null && resource.memoryBytes !== desiredMemoryBytes),
    }
  })
}

function distribute(total: bigint, count: number): bigint[] {
  const divisor = BigInt(count)
  const base = total / divisor
  const remainder = total % divisor
  return Array.from({ length: count }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n))
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
