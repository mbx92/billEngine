import type { ResourceStatus } from '../../../shared/constants/domain'
import type { CoolifyApplication, CoolifyServer } from './types'

export interface NormalizedCoolifyResource {
  coolifyUuid: string
  resourceType: 'application'
  name: string
  status: ResourceStatus
  fqdn: string | null
  projectName: string | null
  environmentName: string | null
  coolifyNodeUuid: string | null
  limitsCpus: string | null
  limitsCpuset: string | null
  limitsCpuShares: number | null
  limitsMemoryBytes: bigint | null
  memoryReservationBytes: bigint | null
  memorySwapBytes: bigint | null
  rawMetadata: Record<string, unknown>
}

export interface NormalizedCoolifyNode {
  coolifyUuid: string
  name: string
  address: string | null
  sshPort: number | null
  status: string
  isReachable: boolean
  isUsable: boolean
  isCoolifyHost: boolean
  rawMetadata: Record<string, unknown>
}

export function normalizeCoolifyStatus(value: string | null | undefined): ResourceStatus {
  const status = value?.toLowerCase() ?? ''
  if (status.includes('restart')) return 'restarting'
  if (status.includes('degraded') || status.includes('unhealthy')) return 'degraded'
  if (status.includes('stop') || status.includes('exit')) return 'stopped'
  if (status.includes('running') && status.includes('healthy')) return 'running'
  return 'unknown'
}

function nullableString(value: string | number | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

/** Parses the Docker memory format used by Coolify, e.g. 512m or 1g. */
export function parseDockerMemoryBytes(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined || value === '') return null

  const normalized = String(value).trim().toLowerCase()
  const match = /^(\d+)([bkmg])?$/.exec(normalized)
  if (!match) return null

  const multipliers: Record<string, bigint> = {
    b: 1n,
    k: 1024n,
    m: 1024n ** 2n,
    g: 1024n ** 3n,
  }

  try {
    return BigInt(match[1]!) * (multipliers[match[2] ?? 'b'] ?? 1n)
  } catch {
    return null
  }
}

const sensitiveMetadataKey = /(password|secret|token|private[_-]?key|credential)/i

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveMetadataKey.test(key) ? '[REDACTED]' : sanitizeMetadata(entry),
    ]),
  )
}

export function normalizeCoolifyApplication(
  application: CoolifyApplication,
): NormalizedCoolifyResource {
  return {
    coolifyUuid: application.uuid,
    resourceType: 'application',
    name: application.name,
    status: normalizeCoolifyStatus(application.status),
    fqdn: application.fqdn ?? application.domains ?? null,
    projectName: application.project?.name ?? null,
    environmentName: application.environment?.name ?? null,
    coolifyNodeUuid: application.destination?.server?.uuid ?? null,
    limitsCpus: nullableString(application.limits_cpus),
    limitsCpuset: application.limits_cpuset ?? null,
    limitsCpuShares: application.limits_cpu_shares ?? null,
    limitsMemoryBytes: parseDockerMemoryBytes(application.limits_memory),
    memoryReservationBytes: parseDockerMemoryBytes(application.limits_memory_reservation),
    memorySwapBytes: parseDockerMemoryBytes(application.limits_memory_swap),
    // Coolify's application payload can include webhook/basic-auth secrets.
    // Keep useful provider metadata for diagnostics without persisting credentials.
    rawMetadata: sanitizeMetadata(application) as Record<string, unknown>,
  }
}

export function normalizeCoolifyServer(server: CoolifyServer): NormalizedCoolifyNode {
  const isReachable = server.is_reachable ?? server.settings?.is_reachable ?? false
  const isUsable = server.is_usable ?? server.settings?.is_usable ?? false

  return {
    coolifyUuid: server.uuid,
    name: server.name,
    address: server.ip ?? null,
    sshPort: server.port ?? null,
    status: isReachable && isUsable ? 'ready' : isReachable ? 'unusable' : 'unreachable',
    isReachable,
    isUsable,
    isCoolifyHost: server.is_coolify_host ?? false,
    rawMetadata: sanitizeMetadata(server) as Record<string, unknown>,
  }
}
