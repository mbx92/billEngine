import type { ApplicationSpec } from '../../../shared/schemas/infrastructure'

export interface ApplicationPolicyLimits {
  maxCpuMilli: number
  maxMemoryBytes: bigint
  maxVolumes: number
  maxPorts: number
}

export const DEFAULT_APPLICATION_POLICY: ApplicationPolicyLimits = {
  maxCpuMilli: 8_000,
  maxMemoryBytes: 16n * 1024n * 1024n * 1024n,
  maxVolumes: 8,
  maxPorts: 8,
}

export function validateApplicationPolicy(
  spec: ApplicationSpec,
  policy: ApplicationPolicyLimits = DEFAULT_APPLICATION_POLICY,
) {
  const violations: string[] = []
  const memoryBytes = BigInt(spec.limits.memoryBytes)

  if (spec.limits.cpuMilli > policy.maxCpuMilli) {
    violations.push(`CPU melebihi batas node (${policy.maxCpuMilli} millicore).`)
  }
  if (memoryBytes > policy.maxMemoryBytes) {
    violations.push(`Memory melebihi batas node (${policy.maxMemoryBytes} byte).`)
  }
  if (spec.volumes.length > policy.maxVolumes) {
    violations.push(`Jumlah volume melebihi batas (${policy.maxVolumes}).`)
  }
  if (spec.ports.length > policy.maxPorts) {
    violations.push(`Jumlah port melebihi batas (${policy.maxPorts}).`)
  }

  const mountTargets = new Set<string>()
  for (const volume of spec.volumes) {
    if (mountTargets.has(volume.mountTarget)) {
      violations.push(`Mount target duplikat: ${volume.mountTarget}.`)
    }
    mountTargets.add(volume.mountTarget)
  }

  const ports = new Set<string>()
  const hostPorts = new Set<string>()
  for (const port of spec.ports) {
    const key = `${port.containerPort}/${port.protocol}`
    if (ports.has(key)) violations.push(`Port duplikat: ${key}.`)
    ports.add(key)
    if (port.hostPort) {
      const hostKey = `${port.hostPort}/${port.protocol}`
      if (hostPorts.has(hostKey)) violations.push(`Host port duplikat: ${hostKey}.`)
      hostPorts.add(hostKey)
    }
  }

  return { allowed: violations.length === 0, violations }
}

export function isUbuntuRelease(value: string) {
  return /(?:^|\s)ubuntu(?:\s|$)/i.test(value.trim())
}
