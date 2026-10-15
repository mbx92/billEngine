import type { InfrastructureOperationStatus } from '../../database/schema'

const transitions: Record<InfrastructureOperationStatus, InfrastructureOperationStatus[]> = {
  queued: ['dispatched', 'cancelled', 'expired'],
  dispatched: ['running', 'queued', 'succeeded', 'failed', 'cancelled', 'expired'],
  running: ['succeeded', 'failed', 'queued', 'cancelled', 'expired'],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
}

export function canTransitionOperation(
  from: InfrastructureOperationStatus,
  to: InfrastructureOperationStatus,
) {
  return transitions[from].includes(to)
}

export function assertOperationTransition(
  from: InfrastructureOperationStatus,
  to: InfrastructureOperationStatus,
) {
  if (!canTransitionOperation(from, to)) {
    throw new Error(`Invalid infrastructure operation transition: ${from} -> ${to}`)
  }
}

export function isTerminalOperationStatus(status: InfrastructureOperationStatus) {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'expired'
  )
}

export function retryDelayMilliseconds(attempt: number, random = Math.random) {
  const normalizedAttempt = Math.max(1, Math.min(attempt, 10))
  const base = Math.min(1_000 * 2 ** (normalizedAttempt - 1), 5 * 60_000)
  const jitter = Math.floor(base * 0.2 * random())
  return base + jitter
}
