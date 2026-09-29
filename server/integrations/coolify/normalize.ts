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
  if (status.includes('running')) return 'running'
  if (status.includes('restart')) return 'restarting'
  if (status.includes('degraded') || status.includes('unhealthy')) return 'degraded'
  if (status.includes('stop') || status.includes('exit')) return 'stopped'
  return 'unknown'
}

function nullableString(value: string | number | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function nullableBigInt(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined || value === '') return null
  try {
    return BigInt(value)
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
    limitsMemoryBytes: nullableBigInt(application.limits_memory),
    memoryReservationBytes: nullableBigInt(application.limits_memory_reservation),
    memorySwapBytes: nullableBigInt(application.limits_memory_swap),
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
